const mongoose = require('mongoose');

const topicPlanItemSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    targetWeekStart: { type: String, required: true },
    categoryId: { type: String, required: true },
    categoryName: { type: String, required: true },
    categoryColor: { type: String, default: '#667eea' },
    text: { type: String, required: true },
    day: { type: Number, min: 0, max: 6, default: null },
    order: { type: Number, default: 0 },
    completed: { type: Boolean, default: false },
    completedAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

topicPlanItemSchema.index({ userId: 1, targetWeekStart: 1 });

module.exports = mongoose.model('TopicPlanItem', topicPlanItemSchema);
