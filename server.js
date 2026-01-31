require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, // limit each IP to 1000 requests per windowMs (increased for development)
    standardHeaders: true,
    legacyHeaders: false,
});
app.use(limiter);

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api/profile', require('./routes/profile.routes'));
app.use('/api/universities', require('./routes/university.routes'));
app.use('/api/shortlist', require('./routes/shortlist.routes'));
app.use('/api/lock', require('./routes/lock.routes'));
app.use('/api/tasks', require('./routes/task.routes'));
app.use('/api/ai', require('./routes/ai.routes'));
app.use('/api/audio', require('./routes/audio.routes'));
app.use('/api/activities', require('./routes/activity.routes'));
app.use('/api/cache', require('./routes/cache.routes'));
app.use('/api/discovery', require('./routes/discovery.routes'));
app.use('/api/chat', require('./routes/chat.routes'));

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(err.status || 500).json({
        error: {
            message: err.message || 'Internal Server Error',
            ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
        }
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: { message: 'Route not found' } });
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📊 Environment: ${process.env.NODE_ENV}`);
    console.log(`🌐 Frontend URL: ${process.env.FRONTEND_URL}`);
});

module.exports = app;
