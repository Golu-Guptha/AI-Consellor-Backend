const supabase = require('../database/supabase');

/**
 * Middleware to verify Supabase JWT token
 * Adds user object to req.user if valid
 * Auto-creates user record if missing
 */
const authMiddleware = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: { message: 'No authorization token provided' } });
        }

        const token = authHeader.split(' ')[1];

        // Verify token with Supabase
        const { data: { user }, error } = await supabase.auth.getUser(token);

        if (error || !user) {
            return res.status(401).json({ error: { message: 'Invalid or expired token' } });
        }

        // Fetch user from database
        let { data: dbUser, error: dbError } = await supabase
            .from('users')
            .select('*')
            .eq('supabase_user_id', user.id)
            .single();

        // Auto-create user if missing (handles case where signup created auth user but not DB user)
        if (dbError && dbError.code === 'PGRST116') { // PGRST116 = no rows found
            console.log('User not found in DB, auto-creating:', user.email);

            const { data: newUser, error: createError } = await supabase
                .from('users')
                .insert({
                    email: user.email,
                    supabase_user_id: user.id,
                    name: user.user_metadata?.name || user.email.split('@')[0]
                })
                .select()
                .single();

            if (createError) {
                console.error('Failed to auto-create user:', createError);

                // If user already exists with this email (duplicate key error), fetch them
                if (createError.code === '23505') {
                    console.log('User already exists with email, fetching existing record:', user.email);
                    const { data: existingUser, error: fetchError } = await supabase
                        .from('users')
                        .select('*')
                        .eq('email', user.email)
                        .single();

                    if (fetchError || !existingUser) {
                        console.error('Failed to fetch existing user:', fetchError);
                        return res.status(500).json({ error: { message: 'Failed to retrieve existing user record' } });
                    }

                    // Update the existing user's supabase_user_id if it's different
                    if (existingUser.supabase_user_id !== user.id) {
                        console.log('Updating supabase_user_id for existing user');
                        const { data: updatedUser, error: updateError } = await supabase
                            .from('users')
                            .update({ supabase_user_id: user.id })
                            .eq('id', existingUser.id)
                            .select()
                            .single();

                        if (updateError) {
                            console.error('Failed to update user:', updateError);
                            return res.status(500).json({ error: { message: 'Failed to update user record' } });
                        }

                        dbUser = updatedUser;
                    } else {
                        dbUser = existingUser;
                    }
                } else {
                    // Some other database error during creation
                    return res.status(500).json({ error: { message: 'Failed to create user record in database' } });
                }
            } else {
                dbUser = newUser;
            }
        } else if (dbError) {
            // Some other database error
            console.error('Database error fetching user:', dbError);
            return res.status(500).json({ error: { message: 'Database error' } });
        }

        if (!dbUser) {
            return res.status(404).json({ error: { message: 'User not found in database' } });
        }

        // Attach user to request
        req.user = dbUser;
        req.supabaseUser = user;

        next();
    } catch (error) {
        console.error('Auth middleware error:', error);
        return res.status(500).json({ error: { message: 'Authentication error' } });
    }
};

module.exports = authMiddleware;
