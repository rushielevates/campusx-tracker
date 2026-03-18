const express = require('express');
const router = express.Router();
const Task = require('../models/Task');

const auth = async (req, res, next) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: 'Please login' });
    }
    next();
};

// GET all tasks
router.get('/', auth, async (req, res) => {
    try {
        const tasks = await Task.find({ userId: req.session.userId }).sort('order');
        res.json(tasks);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST new task
router.post('/', auth, async (req, res) => {
    try {
        const { title } = req.body;
        const count = await Task.countDocuments({ userId: req.session.userId });
        const task = new Task({
            userId: req.session.userId,
            title,
            order: count
        });
        await task.save();
        res.status(201).json(task);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// PUT toggle complete
router.put('/:id', auth, async (req, res) => {
    try {
        const task = await Task.findOne({ _id: req.params.id, userId: req.session.userId });
        if (!task) return res.status(404).json({ error: 'Task not found' });
        
        task.completed = !task.completed;
        await task.save();
        res.json(task);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// DELETE task
router.delete('/:id', auth, async (req, res) => {
    try {
        await Task.findOneAndDelete({ _id: req.params.id, userId: req.session.userId });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST reorder tasks
router.post('/reorder', auth, async (req, res) => {
    try {
        const { orderedIds } = req.body;
        for (let i = 0; i < orderedIds.length; i++) {
            await Task.findOneAndUpdate(
                { _id: orderedIds[i], userId: req.session.userId },
                { order: i }
            );
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
