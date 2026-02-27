const express = require('express');
const session = require('express-session');
const path = require('path');
const dotenv = require('dotenv');
const connectDB = require('./config/database');
const cors = require('cors');
const mongoose = require('mongoose');

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

// Middleware
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Session configuration
app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: false, 
        httpOnly: true, 
        maxAge: 24 * 60 * 60 * 1000 
    }
}));

// ========== TEST ROUTE ==========
app.get('/api/test', (req, res) => {
    res.json({ 
        message: '✅ API is working!', 
        timestamp: new Date().toISOString(),
        env: {
            hasMongoDB: !!process.env.MONGODB_URI,
            hasYouTubeKey: !!process.env.YOUTUBE_API_KEY
        }
    });
});

// ========== API ROUTES ==========
app.use('/api/auth', require('./routes/auth'));
app.use('/api/playlists', require('./routes/playlist'));

// ========== FRONTEND ROUTES ==========
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/dashboard.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// ========== HEALTH CHECK ==========
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// ========== 404 HANDLER ==========
app.use((req, res) => {
    res.status(404).json({ error: 'Route not found', path: req.path });
});

// ========== ERROR HANDLER ==========
app.use((err, req, res, next) => {
    console.error('Server error:', err.stack);
    res.status(500).json({ error: 'Something went wrong!' });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📍 Health check: http://localhost:${PORT}/health`);
    console.log(`📍 Test API: http://localhost:${PORT}/api/test`);
});
