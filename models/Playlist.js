const mongoose = require('mongoose');

const videoSchema = new mongoose.Schema({
    videoId: { type: String, required: true },
    title: { type: String, required: true },
    duration: { type: Number, required: true },
    thumbnail: String,
    position: Number,
    completed: { type: Boolean, default: false },
    completedAt: Date
});

const playlistSchema = new mongoose.Schema({
    playlistId: { type: String, required: true },
    title: { type: String, required: true },
    description: String,
    thumbnail: String,
    videoCount: Number,
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    videos: [videoSchema],
    playlistSpeed: { type: Number, default: 1.0 },
    createdAt: { type: Date, default: Date.now }
});

playlistSchema.methods.getProgress = function() {
    const total = this.videos.length;
    const completed = this.videos.filter(v => v.completed).length;
    return { completed, total, percentage: total > 0 ? (completed / total) * 100 : 0 };
};

playlistSchema.methods.getRemainingTime = function() {
    const remaining = this.videos.filter(v => !v.completed);
    const totalSeconds = remaining.reduce((acc, v) => acc + v.duration, 0);
    const adjustedSeconds = totalSeconds / (this.playlistSpeed || 1.0);
    const hours = Math.floor(adjustedSeconds / 3600);
    const minutes = Math.floor((adjustedSeconds % 3600) / 60);
    return { seconds: adjustedSeconds, formatted: `${hours}h ${minutes}m` };
};

module.exports = mongoose.model('Playlist', playlistSchema);
