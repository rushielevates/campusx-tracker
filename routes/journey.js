const express = require('express');
const router = express.Router();
const Journey = require('../models/Journey');

const auth = async (req, res, next) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: 'Please login' });
    }
    next();
};
// Add this test route at the top
router.get('/test', (req, res) => {
    res.json({ message: 'Journey route is working!' });
});
// Get user's journey
// Get user's journey
router.get('/', auth, async (req, res) => {
    console.log('🔵 GET /api/journey - Starting...');
    try {
        console.log('🔵 Looking for journey for user:', req.session.userId);
        let journey = await Journey.findOne({ userId: req.session.userId });
        
        if (!journey) {
            console.log('🔵 No journey found, creating default...');
            journey = new Journey({
                userId: req.session.userId,
                stages: [{
                    id: `stage_${Date.now()}`,
                    name: 'Stage I: Foundation',
                    order: 1,
                    nodes: [],
                    edges: []
                }],
                activeStageId: null
            });
            await journey.save();
            console.log('✅ Default journey created');
        }
        
        console.log('🔵 Sending journey response...');
        res.json(journey);
        
    } catch (error) {
        console.error('❌ Error in GET /api/journey:', error);
        console.error('Error stack:', error.stack);
        res.status(500).json({ error: error.message, stack: error.stack });
    }
});
// Test endpoint
router.get('/ping', (req, res) => {
    console.log('🔵 PING received!');
    res.json({ message: 'pong', timestamp: Date.now() });
});
// Update journey
router.put('/', auth, async (req, res) => {
    try {
        const { stages, activeStageId } = req.body;
        
        const journey = await Journey.findOneAndUpdate(
            { userId: req.session.userId },
            { stages, activeStageId, updatedAt: new Date() },
            { new: true, upsert: true }
        );
        
        res.json(journey);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Add new stage
router.post('/stage', auth, async (req, res) => {
    try {
        const { name } = req.body;
        const journey = await Journey.findOne({ userId: req.session.userId });
        
        const newStage = {
            id: `stage_${Date.now()}`,
            name: name || `Stage ${journey.stages.length + 1}`,
            order: journey.stages.length + 1,
            nodes: [],
            edges: []
        };
        
        journey.stages.push(newStage);
        await journey.save();
        
        res.json(newStage);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete stage
router.delete('/stage/:stageId', auth, async (req, res) => {
    try {
        const { stageId } = req.params;
        const journey = await Journey.findOne({ userId: req.session.userId });
        
        journey.stages = journey.stages.filter(s => s.id !== stageId);
        await journey.save();
        
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
