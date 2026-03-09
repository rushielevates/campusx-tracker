const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    playlists: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Playlist' }],
    createdAt: { type: Date, default: Date.now },
    // new analytics fields
       learningActivity: [{
        date: { type: Date, required: true },
        videosWatched: { type: Number, default: 0 },
        watchTimeMinutes: { type: Number, default: 0 },
        videosCompleted: [{ type: String }] // videoIds watched on this day
    }],
    
    streak: {
        current: { type: Number, default: 0 },
        longest: { type: Number, default: 0 },
        lastActive: { type: Date }
    },
    
    totalStats: {
        totalVideosWatched: { type: Number, default: 0 },
        totalWatchTimeMinutes: { type: Number, default: 0 },
        totalActiveDays: { type: Number, default: 0 }
    },
     // NEW: Deep work stats
    deepWorkStats: {
        totalSessions: { type: Number, default: 0 },
        totalDeepWorkMinutes: { type: Number, default: 0 },
        currentStreak: { type: Number, default: 0 },
        longestStreak: { type: Number, default: 0 },
        lastSessionDate: { type: Date },
        lastStreakUpdate: { type: Date },  // ← ADD THIS
        // Weekly goals
        weeklyGoal: { type: Number, default: 1200 }, // 20 hours in minutes
        weeklyProgress: { type: Number, default: 0 },
        goalWeekStart: { type: Date },
        
        // Daily stats for bar chart
        dailyStats: [{
            date: { type: Date },
            totalMinutes: { type: Number, default: 0 },
            sessions: { type: Number, default: 0 },
            avgFocusScore: { type: Number, default: 0 }
        }],
        // new task
            customTaskTypes: {
        type: [{
            id: { type: String, required: true },
            name: { type: String, required: true },
            icon: { type: String, default: '⚙️' },
            color: { type: String, default: '#667eea' },
            isActive: { type: Boolean, default: true },
            order: { type: Number, default: 0 }
        }],
        default: [
            { id: 'coding', name: 'Coding', icon: '💻', color: '#28a745', order: 1 },
            { id: 'reading', name: 'Reading', icon: '📚', color: '#17a2b8', order: 2 },
            { id: 'studying', name: 'Studying', icon: '🎓', color: '#ffc107', order: 3 },
            { id: 'writing', name: 'Writing', icon: '✍️', color: '#dc3545', order: 4 },
            { id: 'planning', name: 'Planning', icon: '📋', color: '#6f42c1', order: 5 },
            { id: 'other', name: 'Other', icon: '⚙️', color: '#6c757d', order: 6 }
        ]
    }
    }

});

userSchema.pre('save', async function(next) {
    if (!this.isModified('password')) return next();
    this.password = await bcrypt.hash(this.password, 10);
    next();
});

userSchema.methods.comparePassword = async function(candidatePassword) {
    return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', userSchema);
