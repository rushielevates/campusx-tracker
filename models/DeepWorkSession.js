// New model for tracking deep work sessions
const mongoose = require('mongoose');

const deepWorkSessionSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    startTime: { type: Date, required: true },
    endTime: { type: Date },
    durationMinutes: { type: Number, default: 0 },
    
    // Session details
    taskType: { 
        type: String, 
        default: 'other'
    },
    taskDescription: { type: String, default: '' },
    
    // Deep Work metrics
    interruptions: { type: Number, default: 0 },
    location: { type: String, default: 'home' },
    
    // Quality indicators
    focusScore: { type: Number, min: 0, max: 100, default: 100 },
    completedGoal: { type: Boolean, default: false },
    
    // Optional link to playlist/video
    relatedVideoId: { type: String },
    relatedPlaylistId: { type: String },
    activeSession: {
    type: Boolean,
    default: false
},
lastPingTime: { type: Date }, // To detect crashes
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('DeepWorkSession', deepWorkSessionSchema);
