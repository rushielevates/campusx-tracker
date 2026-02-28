const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Playlist = require('../models/Playlist');

// Auth middleware
const auth = async (req, res, next) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: 'Please login' });
    }
    next();
};

// ===== REFRESH ANALYTICS AFTER VIDEO TOGGLE =====
router.post('/refresh', auth, async (req, res) => {
    try {
        const { videoId, completed, playlistId } = req.body;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const user = await User.findById(req.session.userId);
        
        // Initialize arrays if they don't exist
        if (!user.learningActivity) user.learningActivity = [];
        if (!user.streak) user.streak = { current: 0, longest: 0, lastActive: null };
        if (!user.totalStats) user.totalStats = { totalVideosWatched: 0, totalWatchTimeMinutes: 0, totalActiveDays: 0 };
        
        // Find today's activity
        let todayActivity = user.learningActivity.find(
            a => new Date(a.date).toDateString() === today.toDateString()
        );
        
        if (!todayActivity) {
            // First activity today
            todayActivity = {
                date: today,
                videosWatched: 0,
                watchTimeMinutes: 0,
                videosCompleted: []
            };
            user.learningActivity.push(todayActivity);
            
            // Update streak
            const yesterday = new Date(today);
            yesterday.setDate(yesterday.getDate() - 1);
            
            const wasActiveYesterday = user.learningActivity.some(
                a => new Date(a.date).toDateString() === yesterday.toDateString()
            );
            
            if (wasActiveYesterday) {
                user.streak.current += 1;
            } else {
                user.streak.current = 1;
            }
            
            user.streak.longest = Math.max(user.streak.longest, user.streak.current);
            user.streak.lastActive = today;
            user.totalStats.totalActiveDays += 1;
        }
        
        // Update today's activity based on completion status
        if (completed) {
            // Video was marked complete
            if (!todayActivity.videosCompleted.includes(videoId)) {
                todayActivity.videosWatched += 1;
                todayActivity.videosCompleted.push(videoId);
                user.totalStats.totalVideosWatched += 1;
            }
        } else {
            // Video was marked incomplete
            const index = todayActivity.videosCompleted.indexOf(videoId);
            if (index > -1) {
                todayActivity.videosCompleted.splice(index, 1);
                todayActivity.videosWatched = Math.max(0, todayActivity.videosWatched - 1);
                user.totalStats.totalVideosWatched = Math.max(0, user.totalStats.totalVideosWatched - 1);
            }
        }
        
        // Clean up old activity data (keep last 365 days)
        const oneYearAgo = new Date();
        oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
        user.learningActivity = user.learningActivity.filter(
            a => new Date(a.date) >= oneYearAgo
        );
        
        await user.save();
        
        // Return updated stats for analytics page
        const playlists = await Playlist.find({ userId: req.session.userId });
        let totalWatched = 0;
        let totalVideos = 0;
        playlists.forEach(p => {
            totalWatched += p.videos.filter(v => v.completed).length;
            totalVideos += p.videos.length;
        });
        
        res.json({
            success: true,
            totalStats: {
                totalWatched,
                totalVideos,
                completionPercentage: totalVideos > 0 ? (totalWatched / totalVideos * 100).toFixed(1) : 0,
                totalWatchTimeMinutes: user.totalStats.totalWatchTimeMinutes,
                totalActiveDays: user.totalStats.totalActiveDays
            },
            streak: user.streak,
            todayActivity: {
                date: today,
                count: todayActivity.videosWatched
            }
        });
        
    } catch (error) {
        console.error('Analytics refresh error:', error);
        res.status(500).json({ error: error.message });
    }
});
// ===== GET USER STATS =====
router.get('/user-stats', auth, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        const playlists = await Playlist.find({ userId: req.session.userId });
        
        // Calculate total videos watched across all playlists
        let totalWatched = 0;
        let totalVideos = 0;
        playlists.forEach(p => {
            totalWatched += p.videos.filter(v => v.completed).length;
            totalVideos += p.videos.length;
        });
        
        // Generate calendar data (last 365 days)
        const calendarData = generateCalendarData(user.learningActivity || []);
        
        res.json({
            streak: user.streak || { current: 0, longest: 0 },
            totalStats: {
                totalWatched,
                totalVideos,
                completionPercentage: totalVideos > 0 ? (totalWatched / totalVideos * 100).toFixed(1) : 0,
                totalWatchTimeMinutes: user.totalStats?.totalWatchTimeMinutes || 0,
                totalActiveDays: user.totalStats?.totalActiveDays || 0
            },
            calendarData,
            recentActivity: (user.learningActivity || []).slice(-7) // Last 7 days
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ===== TRACK VIDEO WATCH =====
router.post('/track-watch', auth, async (req, res) => {
    try {
        const { videoId, watchTimeMinutes, playlistId } = req.body;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const user = await User.findById(req.session.userId);
        
        // Initialize arrays if they don't exist
        if (!user.learningActivity) user.learningActivity = [];
        if (!user.streak) user.streak = { current: 0, longest: 0 };
        if (!user.totalStats) user.totalStats = { totalVideosWatched: 0, totalWatchTimeMinutes: 0, totalActiveDays: 0 };
        
        // Find today's activity or create new
        let todayActivity = user.learningActivity.find(
            a => new Date(a.date).toDateString() === today.toDateString()
        );
        
        if (!todayActivity) {
            todayActivity = {
                date: today,
                videosWatched: 0,
                watchTimeMinutes: 0,
                videosCompleted: []
            };
            user.learningActivity.push(todayActivity);
            
            // Update streak
            const yesterday = new Date(today);
            yesterday.setDate(yesterday.getDate() - 1);
            
            const wasActiveYesterday = user.learningActivity.some(
                a => new Date(a.date).toDateString() === yesterday.toDateString()
            );
            
            if (wasActiveYesterday) {
                user.streak.current += 1;
            } else {
                user.streak.current = 1;
            }
            
            user.streak.longest = Math.max(user.streak.longest, user.streak.current);
            user.streak.lastActive = today;
            user.totalStats.totalActiveDays += 1;
        }
        
        // Update today's stats
        todayActivity.watchTimeMinutes += watchTimeMinutes;
        if (!todayActivity.videosCompleted.includes(videoId)) {
            todayActivity.videosWatched += 1;
            todayActivity.videosCompleted.push(videoId);
            user.totalStats.totalVideosWatched += 1;
        }
        
        user.totalStats.totalWatchTimeMinutes += watchTimeMinutes;
        
        await user.save();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ===== GET USER PROFILE =====
router.get('/profile', auth, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId).select('-password');
        const playlists = await Playlist.find({ userId: req.session.userId });
        
        // Calculate total videos watched
        let totalWatched = 0;
        playlists.forEach(p => {
            totalWatched += p.videos.filter(v => v.completed).length;
        });
        
        res.json({
            username: user.username,
            email: user.email,
            createdAt: user.createdAt,
            stats: {
                totalWatched,
                totalPlaylists: playlists.length,
                currentStreak: user.streak?.current || 0,
                longestStreak: user.streak?.longest || 0,
                totalWatchTime: user.totalStats?.totalWatchTimeMinutes || 0,
                totalActiveDays: user.totalStats?.totalActiveDays || 0
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Helper function to generate calendar data
function generateCalendarData(activity) {
    const calendar = [];
    const today = new Date();
    
    // Generate last 52 weeks (364 days)
    for (let i = 363; i >= 0; i--) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        
        const dayActivity = activity.find(
            a => new Date(a.date).toDateString() === date.toDateString()
        );
        
        calendar.push({
            date: date.toISOString().split('T')[0],
            count: dayActivity ? dayActivity.videosWatched : 0,
            intensity: dayActivity ? Math.min(dayActivity.videosWatched, 4) : 0 // 0-4 scale
        });
    }
    
    return calendar;
}

module.exports = router;
