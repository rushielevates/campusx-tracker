const mongoose = require('mongoose');

const resourceSchema = new mongoose.Schema({
    id: String,
    title: String,
    url: String
});

const itemSchema = new mongoose.Schema({
    id: String,
    title: String,
    column: { type: String, default: 'priority' }, // 'priority' or 'secondary'
    order: Number
});

const mainCardSchema = new mongoose.Schema({
    id: String,
    title: String,
    columnNames: {
        priority: { type: String, default: 'Priority' },
        secondary: { type: String, default: 'Secondary' }
    },
    items: [itemSchema],
    resources: [resourceSchema]
});

const stageSchema = new mongoose.Schema({
    id: String,
    name: String,
    order: Number,
    mainCards: [mainCardSchema]
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
