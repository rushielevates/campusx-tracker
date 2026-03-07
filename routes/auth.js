const express = require('express');
const router = express.Router();
const User = require('../models/User');
// Add this at the top with other requires
const auth = async (req, res, next) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: 'Please login' });
    }
    next();
};

router.post('/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;
        const existingUser = await User.findOne({ $or: [{ email }, { username }] });
        if (existingUser) return res.status(400).json({ error: 'User exists' });
        
        const user = new User({ username, email, password });
        await user.save();
        req.session.userId = user._id;
        res.status(201).json({ user: { username, email } });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        console.log('🔐 Login attempt for email:', email);
        console.log('Session ID before login:', req.session.id);
        console.log('User ID before login:', req.session.userId);
        
        const user = await User.findOne({ email });
        if (!user) {
            console.log('❌ User not found');
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        const isMatch = await user.comparePassword(password);
        if (!isMatch) {
            console.log('❌ Password incorrect');
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        // Set session
        req.session.userId = user._id;
        console.log('✅ userId set in session:', user._id);
        console.log('Session ID after set:', req.session.id);
        
        // Force session save and log result
        req.session.save((err) => {
            if (err) {
                console.error('❌ Session save error:', err);
                return res.status(500).json({ error: 'Failed to save session' });
            }
            
            console.log('✅ Session saved successfully');
            console.log('Verifying session - userId:', req.session.userId);

             // ←←← ADD THIS LINE HERE ←←←
    res.setHeader('Set-Cookie', `connect.sid=${req.session.id}; Path=/; HttpOnly; Secure; SameSite=None`);
            // Send success response
            res.json({ 
                success: true,
                user: { 
                    username: user.username, 
                    email: user.email 
                }
            });
        });
        
    } catch (error) {
        console.error('❌ Login error:', error);
        res.status(500).json({ error: error.message });
    }
});

router.get('/logout', (req, res) => {
    req.session.destroy();
    res.json({ message: 'Logged out' });
});

// Add this to routes/auth.js
router.get('/user', auth, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId).select('-password');
        res.json({
            username: user.username,
            email: user.email
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Add to routes/auth.js
router.get('/check', (req, res) => {
    if (req.session && req.session.userId) {
        res.json({ authenticated: true });
    } else {
        res.status(401).json({ authenticated: false });
    }
});
// Add this temporary debug endpoint
router.get('/debug-session', (req, res) => {
    console.log('=== DEBUG SESSION ===');
    console.log('Session ID:', req.session.id);
    console.log('User ID:', req.session.userId);
    console.log('Session exists:', !!req.session);
    
    res.json({
        sessionExists: !!req.session,
        sessionId: req.session.id,
        userId: req.session.userId || null,
        cookie: req.session.cookie
    });
});

module.exports = router;
