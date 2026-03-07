const express = require('express');
const session = require('express-session');
const path = require('path');
const dotenv = require('dotenv');
const connectDB = require('./config/database');
const cors = require('cors');
const mongoose = require('mongoose');
const MongoStore = require('connect-mongo');
// Load environment variables
dotenv.config();

// Connect to MongoDB
connectDB();

// Log MongoDB connection status
mongoose.connection.once('open', () => {
    console.log('✅ MongoDB connected successfully');
});

mongoose.connection.on('error', (err) => {
    console.error('❌ MongoDB connection error:', err);
});

const app = express();

// ===== 1. CORS FIRST =====
const corsOptions = {
    origin: 'https://campusx-tracker.onrender.com',
    credentials: true,
    optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

// ===== 2. JSON and URL encoded parsers =====
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ===== 3. Session middleware =====
app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret-key',
    resave: true,
    saveUninitialized: false,
    name: 'connect.sid',
    store: MongoStore.create({
        mongoUrl: process.env.MONGODB_URI,
        collectionName: 'sessions',
        ttl: 24 * 60 * 60 // 1 day in seconds
    }),
    cookie: { 
        secure: false, 
        httpOnly: true,
        sameSite: 'none',
        maxAge: 24 * 60 * 60 * 1000
    }
}));

// ===== 4. Debug middleware to log all requests =====
app.use((req, res, next) => {
    console.log('=== INCOMING REQUEST ===');
    console.log('Path:', req.path);
    console.log('Method:', req.method);
    console.log('Session ID:', req.session?.id);
    console.log('User ID:', req.session?.userId);
    console.log('Cookie header:', req.headers.cookie);
    console.log('========================');
    next();
});

// ===== 5. Static files =====
app.use(express.static(path.join(__dirname, 'public')));

// ===== 6. DEBUG ROUTES (put these BEFORE your API routes) =====
app.get('/debug-session', (req, res) => {
    console.log('=== DEBUG SESSION ENDPOINT HIT ===');
    res.json({
        sessionExists: !!req.session,
        sessionId: req.session?.id || 'no-session',
        userId: req.session?.userId || null,
        cookie: req.session?.cookie,
        headers: {
            cookie: req.headers.cookie ? 'present' : 'missing',
            origin: req.headers.origin
        }
    });
});

app.get('/api/test', (req, res) => {
    res.json({ 
        message: '✅ API is working!', 
        timestamp: new Date().toISOString(),
        sessionId: req.session?.id || 'no-session',
        userId: req.session?.userId || null,
        env: {
            hasMongoDB: !!process.env.MONGODB_URI,
            hasYouTubeKey: !!process.env.YOUTUBE_API_KEY
        }
    });
});

// ===== 7. API ROUTES =====
app.use('/api/auth', require('./routes/auth'));
app.use('/api/playlists', require('./routes/playlist'));
app.use('/api/analytics', require('./routes/analytics'));
app.use('/api/deepwork', require('./routes/deepwork'));

// ===== 8. FRONTEND ROUTES =====
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/dashboard.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/analytics.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'analytics.html'));
});

app.get('/profile.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'profile.html'));
});

// ===== 9. HEALTH CHECK =====
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// ===== 10. 404 HANDLER =====
app.use((req, res) => {
    res.status(404).json({ error: 'Route not found', path: req.path });
});

// ===== 11. ERROR HANDLER =====
app.use((err, req, res, next) => {
    console.error('Server error:', err.stack);
    res.status(500).json({ error: 'Something went wrong!' });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📍 Health check: http://localhost:${PORT}/health`);
    console.log(`📍 Test API: http://localhost:${PORT}/api/test`);
    console.log(`📍 Debug session: http://localhost:${PORT}/debug-session`);
});
