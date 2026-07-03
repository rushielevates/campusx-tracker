const mongoose = require('mongoose');

const scheduledDeepWorkBlockSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    targetWeekStart: { type: String, required: true },
    sourceReviewWeekStart: { type: String },
    taskTypeId: { type: String, required: true },
    taskName: { type: String, required: true },
    taskIcon: { type: String, default: '' },
    color: { type: String, default: '#667eea' },
    startMinute: { type: Number, required: true, min: 0, max: 1439 },
    endMinute: { type: Number, required: true, min: 1, max: 1440 },
    repeatDays: [{ type: Number, min: 0, max: 6 }],
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

scheduledDeepWorkBlockSchema.index({ userId: 1, targetWeekStart: 1 });

module.exports = mongoose.model('ScheduledDeepWorkBlock', scheduledDeepWorkBlockSchema);
