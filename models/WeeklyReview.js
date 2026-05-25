const mongoose = require('mongoose');

const weeklyReviewSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    weekStart: { type: String, required: true },
    weekEnd: { type: String, required: true },
    appliesToWeekStart: { type: String, required: true },
    goalMinutes: { type: Number, default: 1500 },
    answers: {
        workedEveryDay: { type: String, default: '' },
        sessionsLongEnough: { type: String, default: '' },
        categorySplit: { type: String, default: '' },
        bestBlock: { type: String, default: '' },
        nextWeekConstraint: { type: String, default: '' }
    },
    isCompleted: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

weeklyReviewSchema.index({ userId: 1, weekStart: 1 }, { unique: true });
weeklyReviewSchema.index({ userId: 1, appliesToWeekStart: 1 });

weeklyReviewSchema.pre('save', function(next) {
    this.updatedAt = new Date();
    next();
});

module.exports = mongoose.model('WeeklyReview', weeklyReviewSchema);
