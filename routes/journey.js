const express = require('express');
const router = express.Router();
const Journey = require('../models/Journey');

const auth = async (req, res, next) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: 'Please login' });
    }
    next();
};

function hasJourneyContent(stages = []) {
    return stages.some(stage => {
        const mainCards = Array.isArray(stage.mainCards) ? stage.mainCards : [];
        return mainCards.some(card => {
            const hasTitle = typeof card.title === 'string' && card.title.trim() && card.title.trim() !== 'New Topic';
            const hasItems = Array.isArray(card.items) && card.items.length > 0;
            const hasResources = Array.isArray(card.resources) && card.resources.length > 0;
            return hasTitle || hasItems || hasResources;
        });
    });
}

function normalizeStages(stages) {
    if (!Array.isArray(stages) || stages.length === 0) {
        return null;
    }

    return stages.map((stage, index) => ({
        id: stage.id || `stage_${Date.now()}_${index}`,
        name: stage.name || `Stage ${index + 1}`,
        order: Number.isFinite(Number(stage.order)) ? Number(stage.order) : index + 1,
        mainCards: Array.isArray(stage.mainCards) ? stage.mainCards : []
    }));
}

// Get user's journey
router.get('/', auth, async (req, res) => {
    try {
        let journey = await Journey.findOne({ userId: req.session.userId });
        
        if (!journey) {
            const defaultStage = {
                id: `stage_${Date.now()}`,
                name: 'Stage I: Foundation',
                order: 1,
                mainCards: []
            };
            
            journey = new Journey({
                userId: req.session.userId,
                stages: [defaultStage],
                activeStageId: defaultStage.id
            });
            await journey.save();
        }
        
        res.json(journey);
    } catch (error) {
        console.error('Error in GET /api/journey:', error);
        res.status(500).json({ error: error.message });
    }
});

// Update journey
router.put('/', auth, async (req, res) => {
    try {
        const { stages, activeStageId } = req.body;
        const normalizedStages = normalizeStages(stages);

        if (!normalizedStages) {
            return res.status(400).json({ error: 'Journey must include at least one stage' });
        }

        const stageIds = normalizedStages.map(stage => stage.id);
        const nextActiveStageId = stageIds.includes(activeStageId) ? activeStageId : stageIds[0];
        const existingJourney = await Journey.findOne({ userId: req.session.userId });

        if (
            existingJourney &&
            hasJourneyContent(existingJourney.stages) &&
            !hasJourneyContent(normalizedStages)
        ) {
            return res.status(409).json({
                error: 'Refusing to replace an existing journey with an empty one'
            });
        }
        
        const journey = await Journey.findOneAndUpdate(
            { userId: req.session.userId },
            { stages: normalizedStages, activeStageId: nextActiveStageId, updatedAt: new Date() },
            { new: true, upsert: true }
        );
        
        res.json(journey);
    } catch (error) {
        console.error('Error in PUT /api/journey:', error);
        res.status(500).json({ error: error.message });
    }
});

// Add new stage
router.post('/stage', auth, async (req, res) => {
    try {
        const { name } = req.body;
        const journey = await Journey.findOne({ userId: req.session.userId });
        
        if (!journey) {
            return res.status(404).json({ error: 'Journey not found' });
        }
        
        const newStage = {
            id: `stage_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
            name: name || `Stage ${journey.stages.length + 1}`,
            order: journey.stages.length + 1,
            mainCards: []
        };
        
        journey.stages.push(newStage);
        await journey.save();
        
        res.status(201).json(newStage);
    } catch (error) {
        console.error('Error adding stage:', error);
        res.status(500).json({ error: error.message });
    }
});

// Delete stage
router.delete('/stage/:stageId', auth, async (req, res) => {
    try {
        const { stageId } = req.params;
        const journey = await Journey.findOne({ userId: req.session.userId });

        if (!journey) {
            return res.status(404).json({ error: 'Journey not found' });
        }

        if (journey.stages.length <= 1) {
            return res.status(400).json({ error: 'Keep at least one stage in your journey' });
        }
        
        journey.stages = journey.stages.filter(s => s.id !== stageId);
        
        if (journey.activeStageId === stageId && journey.stages.length > 0) {
            journey.activeStageId = journey.stages[0].id;
        }
        
        await journey.save();
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting stage:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
