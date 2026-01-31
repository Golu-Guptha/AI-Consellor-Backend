const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const supabase = require('../database/supabase');
const { logActivity } = require('../services/activityTracker');

// Get user locks
router.get('/', authMiddleware, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('university_locks')
            .select(`
        *,
        university:universities(*)
      `)
            .eq('user_id', req.user.id)
            .is('unlocked_at', null); // Only active locks

        if (error) throw error;

        res.json({ locks: data || [] });
    } catch (error) {
        console.error('Get locks error:', error);
        res.status(500).json({ error: { message: 'Failed to fetch locks' } });
    }
});

// Lock a university
router.post('/', authMiddleware, async (req, res) => {
    try {
        const { university_id, reason } = req.body;

        if (!university_id) {
            return res.status(400).json({ error: { message: 'university_id is required' } });
        }

        // Check if profile is complete
        const { data: profile } = await supabase
            .from('profiles')
            .select('profile_complete')
            .eq('user_id', req.user.id)
            .single();

        if (!profile || !profile.profile_complete) {
            return res.status(403).json({
                error: { message: 'Please complete your profile before locking universities' }
            });
        }

        // Check if already locked
        const { data: existingLock } = await supabase
            .from('university_locks')
            .select('*')
            .eq('user_id', req.user.id)
            .eq('university_id', university_id)
            .is('unlocked_at', null)
            .single();

        if (existingLock) {
            return res.status(409).json({ error: { message: 'University already locked' } });
        }

        // Create lock
        const { data, error } = await supabase
            .from('university_locks')
            .insert({
                user_id: req.user.id,
                university_id,
                lock_reason_text: reason || 'User locked for application'
            })
            .select(`
        *,
        university:universities(*)
      `)
            .single();

        if (error) throw error;

        // Log action to audit logs
        await supabase.from('audit_logs').insert({
            user_id: req.user.id,
            action_type: 'LOCK_UNIVERSITY',
            payload: { university_id, reason }
        });

        // Log activity for AI awareness
        await logActivity(req.user.id, 'LOCK_UNIVERSITY', university_id, {
            university_name: data.university?.name,
            country: data.university?.country,
            reason: reason || 'User locked for application'
        });

        res.json({ lock: data, message: 'University locked successfully' });
    } catch (error) {
        console.error('Lock university error:', error);
        res.status(500).json({ error: { message: 'Failed to lock university' } });
    }
});

// Unlock a university
router.post('/:id/unlock', authMiddleware, async (req, res) => {
    try {
        const { reason } = req.body;

        const { data, error } = await supabase
            .from('university_locks')
            .update({
                unlocked_at: new Date().toISOString()
            })
            .eq('id', req.params.id)
            .eq('user_id', req.user.id)
            .is('unlocked_at', null)
            .select()
            .single();

        if (error) throw error;

        // Log action
        await supabase.from('audit_logs').insert({
            user_id: req.user.id,
            action_type: 'UNLOCK_UNIVERSITY',
            payload: { lock_id: req.params.id, reason }
        });

        res.json({ message: 'University unlocked successfully', lock: data });
    } catch (error) {
        console.error('Unlock university error:', error);
        res.status(500).json({ error: { message: 'Failed to unlock university' } });
    }
});

// Unlock a university
router.delete('/:lockId', authMiddleware, async (req, res) => {
    try {
        const { lockId } = req.params;

        // Verify the lock belongs to the user
        const { data: lock } = await supabase
            .from('university_locks')
            .select('*')
            .eq('id', lockId)
            .eq('user_id', req.user.id)
            .single();

        if (!lock) {
            return res.status(404).json({ error: { message: 'Lock not found' } });
        }

        // Delete the lock
        const { error } = await supabase
            .from('university_locks')
            .delete()
            .eq('id', lockId)
            .eq('user_id', req.user.id);

        if (error) throw error;

        res.json({ message: 'University unlocked successfully' });
    } catch (error) {
        console.error('Unlock university error:', error);
        res.status(500).json({ error: { message: 'Failed to unlock university' } });
    }
});

// Update document checklist status for a locked university
router.patch('/:id/document-status', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { documentName, status } = req.body;

        // Validate status
        const validStatuses = ['TODO', 'IN_PROGRESS', 'DONE'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ error: { message: 'Invalid status. Must be TODO, IN_PROGRESS, or DONE' } });
        }

        if (!documentName) {
            return res.status(400).json({ error: { message: 'documentName is required' } });
        }

        // Fetch current lock
        const { data: lock, error: lockError } = await supabase
            .from('university_locks')
            .select('*')
            .eq('id', id)
            .eq('user_id', req.user.id)
            .single();

        if (lockError || !lock) {
            return res.status(404).json({ error: { message: 'Lock not found' } });
        }

        // Get current checklist or initialize from guidance
        let checklist = lock.document_checklist || [];

        // If checklist doesn't exist but guidance does, initialize from guidance
        if (checklist.length === 0 && lock.application_guidance?.required_documents) {
            checklist = lock.application_guidance.required_documents.map(doc => ({
                name: typeof doc === 'object' ? (doc.name || doc.title || doc.description) : doc,
                status: 'TODO'
            }));
        }

        // Find and update the document
        const docIndex = checklist.findIndex(doc => doc.name === documentName);
        if (docIndex === -1) {
            return res.status(404).json({ error: { message: 'Document not found in checklist' } });
        }

        checklist[docIndex].status = status;

        // Update database
        const { data: updatedLock, error: updateError } = await supabase
            .from('university_locks')
            .update({ document_checklist: checklist })
            .eq('id', id)
            .select()
            .single();

        if (updateError) throw updateError;

        // Log activity
        await logActivity(req.user.id, 'DOCUMENT_STATUS_UPDATE', id, {
            document_name: documentName,
            new_status: status
        });

        res.json({
            checklist: updatedLock.document_checklist,
            message: 'Document status updated successfully'
        });

    } catch (error) {
        console.error('Update document status error:', error);
        res.status(500).json({ error: { message: 'Failed to update document status' } });
    }
});

// Upload file for a document in the checklist
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configure multer for temporary file storage
const upload = multer({
    dest: 'uploads/documents/',
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: (req, file, cb) => {
        // Accept documents only
        const allowedTypes = /pdf|doc|docx|jpg|jpeg|png/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);

        if (extname && mimetype) {
            return cb(null, true);
        } else {
            cb(new Error('Only document files (PDF, DOC, DOCX, JPG, PNG) are allowed'));
        }
    }
});

router.post('/:id/document-upload', authMiddleware, upload.single('file'), async (req, res) => {
    try {
        const { id } = req.params;
        const { documentName } = req.body;

        if (!req.file) {
            return res.status(400).json({ error: { message: 'No file uploaded' } });
        }

        if (!documentName) {
            // Clean up uploaded file
            fs.unlinkSync(req.file.path);
            return res.status(400).json({ error: { message: 'documentName is required' } });
        }

        // Fetch current lock
        const { data: lock, error: lockError } = await supabase
            .from('university_locks')
            .select('*')
            .eq('id', id)
            .eq('user_id', req.user.id)
            .single();

        if (lockError || !lock) {
            fs.unlinkSync(req.file.path);
            return res.status(404).json({ error: { message: 'Lock not found' } });
        }

        // Upload file to Supabase Storage
        const fileExt = path.extname(req.file.originalname);
        const fileName = `${req.user.id}/${id}/${Date.now()}_${documentName.replace(/[^a-z0-9]/gi, '_')}${fileExt}`;

        const fileBuffer = fs.readFileSync(req.file.path);

        const { data: uploadData, error: uploadError } = await supabase.storage
            .from('application-documents')
            .upload(fileName, fileBuffer, {
                contentType: req.file.mimetype,
                upsert: false
            });

        // Clean up temp file
        fs.unlinkSync(req.file.path);

        if (uploadError) {
            console.error('Supabase storage upload error:', uploadError);
            return res.status(500).json({ error: { message: 'Failed to upload file to storage' } });
        }

        // Get public URL
        const { data: { publicUrl } } = supabase.storage
            .from('application-documents')
            .getPublicUrl(fileName);

        // Update checklist with file URL
        let checklist = lock.document_checklist || [];

        const docIndex = checklist.findIndex(doc => doc.name === documentName);
        if (docIndex === -1) {
            return res.status(404).json({ error: { message: 'Document not found in checklist' } });
        }

        checklist[docIndex] = {
            ...checklist[docIndex],
            fileUrl: publicUrl,
            fileName: req.file.originalname,
            uploadedAt: new Date().toISOString(),
            status: 'DONE' // Auto-mark as done when file is uploaded
        };

        // Update database
        const { data: updatedLock, error: updateError } = await supabase
            .from('university_locks')
            .update({ document_checklist: checklist })
            .eq('id', id)
            .select()
            .single();

        if (updateError) throw updateError;

        // Log activity
        await logActivity(req.user.id, 'DOCUMENT_UPLOAD', id, {
            document_name: documentName,
            file_name: req.file.originalname
        });

        res.json({
            checklist: updatedLock.document_checklist,
            message: 'File uploaded successfully',
            fileUrl: publicUrl
        });

    } catch (error) {
        // Clean up temp file on error
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        console.error('Upload file error:', error);
        res.status(500).json({ error: { message: 'Failed to upload file' } });
    }
});

// Generate Application Guidance for a lock
router.post('/:id/generate-guidance', authMiddleware, async (req, res) => {
    const { generateApplicationGuidance } = require('../services/aiService');

    try {
        const { id } = req.params;
        console.log('[DEBUG] Generate guidance request for lock ID:', id);

        // Fetch lock details
        const { data: lock, error: lockError } = await supabase
            .from('university_locks')
            .select(`*, university:universities(*)`)
            .eq('id', id)
            .eq('user_id', req.user.id)
            .single();

        console.log('[DEBUG] Lock found:', lock ? `${lock.university?.name} (${lock.university?.country})` : 'NOT FOUND');

        if (!lock) return res.status(404).json({ error: { message: 'Lock not found' } });

        // If guidance already exists and not forced, return it
        if (lock.application_guidance && Object.keys(lock.application_guidance).length > 0 && !req.body.force) {
            console.log('[DEBUG] Returning existing guidance (not forced)');
            return res.json({ guidance: lock.application_guidance });
        }

        // Fetch profile for context
        const { data: profile } = await supabase
            .from('profiles')
            .select('*')
            .eq('user_id', req.user.id)
            .single();

        console.log('[DEBUG] Generating AI guidance...');

        // Generate guidance
        const guidance = await generateApplicationGuidance(
            lock.university.name,
            lock.university.country,
            profile || {}
        );

        console.log('[DEBUG] Guidance generated:', JSON.stringify(guidance).substring(0, 200));

        // Initialize document checklist from the generated guidance
        const documentChecklist = (guidance.required_documents || []).map(doc => ({
            name: typeof doc === 'object' ? (doc.name || doc.title || doc.description) : doc,
            status: 'TODO'
        }));

        console.log('[DEBUG] Document checklist created with', documentChecklist.length, 'items');

        // Save to database (both guidance and checklist)
        const { error: updateError } = await supabase
            .from('university_locks')
            .update({
                application_guidance: guidance,
                document_checklist: documentChecklist
            })
            .eq('id', id);

        if (updateError) {
            console.error('[ERROR] Failed to save guidance:', updateError);
            throw updateError;
        }

        console.log('[DEBUG] Guidance saved successfully');
        res.json({ guidance, checklist: documentChecklist });

    } catch (error) {
        console.error('[ERROR] Generate guidance error:', error);
        res.status(500).json({ error: { message: 'Failed to generate guidance' } });
    }
});

module.exports = router;
