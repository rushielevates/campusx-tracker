const mongoose = require('mongoose');

const resourceSchema = new mongoose.Schema({
    id: { type: String, required: true },
    title: { type: String, required: true },
    url: { type: String },
    type: { type: String, default: 'link' }
});

const stepNodeSchema = new mongoose.Schema({
    id: { type: String, required: true },
    type: { type: String, default: 'stepNode' },
    data: {
        title: String,
        url: String,
        progress: String,
        resources: [resourceSchema]
    },
    position: { x: Number, y: Number }
});

const trackNodeSchema = new mongoose.Schema({
    id: { type: String, required: true },
    type: { type: String, default: 'trackNode' },
    data: {
        title: String,
        status: String,
        children: [stepNodeSchema]
    },
    position: { x: Number, y: Number }
});

const stageSchema = new mongoose.Schema({
    id: { type: String, required: true },
    name: { type: String, required: true },
    order: { type: Number, default: 0 },
    nodes: [trackNodeSchema],
    edges: [{
        id: String,
        source: String,
        target: String
    }]
});

const journeySchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, default: 'My Learning Journey' },
    stages: [stageSchema],
    activeStageId: { type: String },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Journey', journeySchema);
