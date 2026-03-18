const express = require('express');
const router = express.Router();
const Note = require('../models/Note');

const auth = async (req, res, next) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: 'Please login' });
    }
    next();
};

// GET all notes
router.get('/', auth, async (req, res) => {
    try {
        const notes = await Note.find({ userId: req.session.userId });
        res.json(notes);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST new note
router.post('/', auth, async (req, res) => {
    try {
        const { title, content } = req.body;
        const note = new Note({
            userId: req.session.userId,
            title,
            content
        });
        await note.save();
        res.status(201).json(note);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// PUT update note
router.put('/:id', auth, async (req, res) => {
    try {
        const { title, content } = req.body;
        const note = await Note.findOne({ _id: req.params.id, userId: req.session.userId });
        if (!note) return res.status(404).json({ error: 'Note not found' });
        
        note.title = title;
        note.content = content;
        await note.save();
        res.json(note);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// DELETE note
router.delete('/:id', auth, async (req, res) => {
    try {
        await Note.findOneAndDelete({ _id: req.params.id, userId: req.session.userId });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
