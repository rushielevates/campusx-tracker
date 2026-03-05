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
            const localDateStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
            todayActivity = {
                date: localDateStr,
                videosWatched: 0,
                watchTimeMinutes: 0,
                videosCompleted: []
            };
            user.learningActivity.push(todayActivity);
            console.log('activityData sample:', Object.entries(activityData).slice(0,3));
const today = new Date();
const todayKey = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
console.log('Today key:', todayKey, 'count:', activityData[todayKey]);
            // Update streak with reset logic
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
        
        // Get playlists for total stats
        const playlists = await Playlist.find({ userId: req.session.userId });
        let totalWatched = 0;
        let totalVideos = 0;
        playlists.forEach(p => {
            totalWatched += p.videos.filter(v => v.completed).length;
            totalVideos += p.videos.length;
        });
        
        // Generate fresh calendar data
        const calendarData = generateCalendarData(user.learningActivity || []);
        
        // Recalculate streak
        const recalculatedStreak = calculateStreakWithReset(user.learningActivity || []);
        
        // Return ALL data needed for updates
        res.json({
            success: true,
            totalStats: {
                totalWatched,
                totalVideos,
                completionPercentage: totalVideos > 0 ? (totalWatched / totalVideos * 100).toFixed(1) : 0,
                totalWatchTimeMinutes: user.totalStats.totalWatchTimeMinutes,
                totalActiveDays: user.totalStats.totalActiveDays
            },
            streak: recalculatedStreak,
            todayActivity: {
                date: today,
                count: todayActivity.videosWatched
            },
            calendarData: calendarData  // This is crucial for color updates
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
        
        // Recalculate streak with proper reset logic
        const recalculatedStreak = calculateStreakWithReset(user.learningActivity || []);
        
        // Update user's streak if it changed
        if (!user.streak || 
            recalculatedStreak.current !== user.streak.current || 
            recalculatedStreak.longest !== user.streak.longest) {
            user.streak = recalculatedStreak;
            await user.save();
        }
        
        // Generate calendar data
        const calendarData = generateCalendarData(user.learningActivity || []);
        
        // Get recent activity (last 7 days)
        const recentActivity = (user.learningActivity || [])
            .sort((a, b) => new Date(b.date) - new Date(a.date))
            .slice(0, 7);
        
        res.json({
            streak: recalculatedStreak,
            totalStats: {
                totalWatched,
                totalVideos,
                completionPercentage: totalVideos > 0 ? (totalWatched / totalVideos * 100).toFixed(1) : 0,
                totalWatchTimeMinutes: user.totalStats?.totalWatchTimeMinutes || 0,
                totalActiveDays: user.totalStats?.totalActiveDays || 0
            },
            calendarData,
            recentActivity
        });
    } catch (error) {
        console.error('Error in user-stats:', error);
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
        if (!user.streak) user.streak = { current: 0, longest: 0, lastActive: null };
        if (!user.totalStats) user.totalStats = { totalVideosWatched: 0, totalWatchTimeMinutes: 0, totalActiveDays: 0 };
        
        // Find today's activity or create new
        let todayActivity = user.learningActivity.find(
            a => new Date(a.date).toDateString() === today.toDateString()
        );
        
        if (!todayActivity) {
            const localDateStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
            todayActivity = {
                date: localDateStr,
                videosWatched: 0,
                watchTimeMinutes: 0,
                videosCompleted: []
            };
            user.learningActivity.push(todayActivity);
            
            // Update streak with reset logic
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
        console.error('Error in track-watch:', error);
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
        
        // Recalculate streak for profile too
        const recalculatedStreak = calculateStreakWithReset(user.learningActivity || []);
        
        res.json({
            username: user.username,
            email: user.email,
            createdAt: user.createdAt,
            stats: {
                totalWatched,
                totalPlaylists: playlists.length,
                currentStreak: recalculatedStreak.current,
                longestStreak: recalculatedStreak.longest,
                totalWatchTime: user.totalStats?.totalWatchTimeMinutes || 0,
                totalActiveDays: user.totalStats?.totalActiveDays || 0
            }
        });
    } catch (error) {
        console.error('Error in profile:', error);
        res.status(500).json({ error: error.message });
    }
});

// ===== HELPER FUNCTION: Calculate streak with proper reset logic =====
function calculateStreakWithReset(learningActivity) {
    if (!learningActivity || learningActivity.length === 0) {
        return { current: 0, longest: 0 };
    }
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Create a Set of active date strings for O(1) lookup
    const activeDateSet = new Set(
        learningActivity.map(a => new Date(a.date).toDateString())
    );
    
    // Check if user was active today
    const todayStr = today.toDateString();
    const activeToday = activeDateSet.has(todayStr);
    
    // STREAK CALCULATION LOGIC
    let currentStreak = 0;
    
    if (activeToday) {
        // User active today → streak at least 1
        currentStreak = 1;
        let checkDate = new Date(today);
        
        // Count backwards consecutive days
        while (true) {
            checkDate.setDate(checkDate.getDate() - 1);
            const checkStr = checkDate.toDateString();
            
            if (activeDateSet.has(checkStr)) {
                currentStreak++;
            } else {
                break;
            }
        }
    } else {
        // Not active today, check if active yesterday
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toDateString();
        const activeYesterday = activeDateSet.has(yesterdayStr);
        
        if (activeYesterday) {
            // Active yesterday but not today → streak counts from yesterday
            currentStreak = 1;
            let checkDate = new Date(yesterday);
            
            while (true) {
                checkDate.setDate(checkDate.getDate() - 1);
                const checkStr = checkDate.toDateString();
                
                if (activeDateSet.has(checkStr)) {
                    currentStreak++;
                } else {
                    break;
                }
            }
        } else {
            // No activity today AND no activity yesterday → streak = 0
            currentStreak = 0;
        }
    }
    
    // Calculate longest streak historically
    let longestStreak = 0;
    let tempStreak = 0;
    
    if (learningActivity.length > 0) {
        // Get all dates in the activity range
        const dates = learningActivity.map(a => new Date(a.date).setHours(0, 0, 0, 0));
        const minDate = new Date(Math.min(...dates));
        const maxDate = new Date(Math.max(...dates));
        
        let currentDate = new Date(minDate);
        
        while (currentDate <= maxDate) {
            const dateStr = currentDate.toDateString();
            
            if (activeDateSet.has(dateStr)) {
                tempStreak++;
                longestStreak = Math.max(longestStreak, tempStreak);
            } else {
                tempStreak = 0;
            }
            
            // Move to next day
            currentDate.setDate(currentDate.getDate() + 1);
        }
    }
    
    // Also check if current streak is longer than historical
    longestStreak = Math.max(longestStreak, currentStreak);
    
    return {
        current: currentStreak,
        longest: longestStreak
    };
}

// ===== HELPER FUNCTION: Generate calendar data =====
function generateCalendarData(activity) {
    const calendar = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Create a map for quick lookup using local date string
    const activityMap = new Map();
    activity.forEach(day => {
        // Convert the stored date to local date string for consistent lookup
        const activityDate = new Date(day.date);
        // Format as YYYY/MM/DD to avoid timezone issues
        const year = activityDate.getFullYear();
        const month = String(activityDate.getMonth() + 1).padStart(2, '0');
        const dayNum = String(activityDate.getDate()).padStart(2, '0');
        const localDateStr = `${year}/${month}/${dayNum}`;
        
        activityMap.set(localDateStr, {
            count: day.videosWatched,
            watchTime: day.watchTimeMinutes || 0
        });
    });
    
    // Generate last 52 weeks (364 days)
    for (let i = 363; i >= 0; i--) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        
        // Format the current date as YYYY/MM/DD for lookup
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const dayNum = String(date.getDate()).padStart(2, '0');
        const localDateStr = `${year}/${month}/${dayNum}`;
        
        const dayData = activityMap.get(localDateStr);
        const count = dayData ? dayData.count : 0;
        
        // Intensity calculation (0-4 scale)
        let intensity = 0;
        if (count >= 7) intensity = 4;
        else if (count >= 5) intensity = 3;
        else if (count >= 3) intensity = 2;
        else if (count >= 1) intensity = 1;
        
        calendar.push({
            date: localDateStr,  // Send as YYYY/MM/DD format
            count: count,
            intensity: intensity
        });
    }
    
    return calendar;
}

module.exports = router;
