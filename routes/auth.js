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
        const user = await User.findOne({ email });
        if (!user) return res.status(401).json({ error: 'Invalid credentials' });
        
        const isMatch = await user.comparePassword(password);
        if (!isMatch) return res.status(401).json({ error: 'Invalid credentials' });
        
        req.session.userId = user._id;
        res.json({ user: { username: user.username, email: user.email } });
    } catch (error) {
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

module.exports = router;
