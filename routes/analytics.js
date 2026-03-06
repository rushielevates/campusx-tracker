const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Playlist = require('../models/Playlist');

// Auth middleware
const auth = async (req, res, next) => {
    if (!req.session || !req.session.userId) {
        console.log('[AUTH] Unauthorized access attempt');
        return res.status(401).json({ error: 'Please login' });
    }
    console.log(`[AUTH] User ${req.session.userId} authenticated`);
    next();
};

// ===== REFRESH ANALYTICS AFTER VIDEO TOGGLE =====
router.post('/refresh', auth, async (req, res) => {
    console.log('\n========== [REFRESH] ==========');
    console.log('Request body:', req.body);
    const { videoId, completed, playlistId } = req.body;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
    console.log('Today date string:', todayStr);
    
    try {
        const user = await User.findById(req.session.userId);
        console.log('User found:', user._id);
        
        // Initialize arrays if they don't exist
        if (!user.learningActivity) {
            console.log('Initializing learningActivity');
            user.learningActivity = [];
        }
        if (!user.streak) {
            console.log('Initializing streak');
            user.streak = { current: 0, longest: 0, lastActive: null };
        }
        if (!user.totalStats) {
            console.log('Initializing totalStats');
            user.totalStats = { totalVideosWatched: 0, totalWatchTimeMinutes: 0, totalActiveDays: 0 };
        }
        
        // Find today's activity by string comparison
        console.log('Searching for today activity with date:', todayStr);
        let todayActivity = user.learningActivity.find(a => a.date === todayStr);
        console.log('Today activity found?', todayActivity ? 'Yes' : 'No');
        
        if (!todayActivity) {
            console.log('Creating new activity for today');
            todayActivity = {
                date: todayStr,
                videosWatched: 0,
                watchTimeMinutes: 0,
                videosCompleted: []
            };
            user.learningActivity.push(todayActivity);
            
            // Update streak with reset logic
            const yesterday = new Date(today);
            yesterday.setDate(yesterday.getDate() - 1);
            const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth()+1).padStart(2,'0')}-${String(yesterday.getDate()).padStart(2,'0')}`;
            console.log('Checking yesterday activity:', yesterdayStr);
            const wasActiveYesterday = user.learningActivity.some(a => a.date === yesterdayStr);
            console.log('Was active yesterday?', wasActiveYesterday);
            
            if (wasActiveYesterday) {
                user.streak.current += 1;
                console.log('Streak incremented to', user.streak.current);
            } else {
                user.streak.current = 1;
                console.log('Streak reset to 1 (new streak)');
            }
            
            user.streak.longest = Math.max(user.streak.longest, user.streak.current);
            user.streak.lastActive = today;
            user.totalStats.totalActiveDays += 1;
            console.log('Updated streak:', user.streak);
            console.log('Total active days:', user.totalStats.totalActiveDays);
        } else {
            console.log('Existing today activity:', todayActivity);
        }
        
        // Update today's activity based on completion status
        console.log('Updating activity. Completed?', completed);
        if (completed) {
            if (!todayActivity.videosCompleted.includes(videoId)) {
                todayActivity.videosWatched += 1;
                todayActivity.videosCompleted.push(videoId);
                user.totalStats.totalVideosWatched += 1;
                console.log('Video marked complete. New videosWatched:', todayActivity.videosWatched);
                console.log('Videos completed now:', todayActivity.videosCompleted);
            } else {
                console.log('Video already completed, no change');
            }
        } else {
            const index = todayActivity.videosCompleted.indexOf(videoId);
            if (index > -1) {
                todayActivity.videosCompleted.splice(index, 1);
                todayActivity.videosWatched = Math.max(0, todayActivity.videosWatched - 1);
                user.totalStats.totalVideosWatched = Math.max(0, user.totalStats.totalVideosWatched - 1);
                console.log('Video marked incomplete. New videosWatched:', todayActivity.videosWatched);
                console.log('Videos completed now:', todayActivity.videosCompleted);
            } else {
                console.log('Video was not completed, no change');
            }
        }
        
        // Clean up old activity data (keep last 365 days)
        const oneYearAgo = new Date();
        oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
        const originalLength = user.learningActivity.length;
        user.learningActivity = user.learningActivity.filter(a => new Date(a.date) >= oneYearAgo);
        console.log(`Cleaned up learningActivity: ${originalLength} -> ${user.learningActivity.length}`);
        
        await user.save();
        console.log('User saved successfully');
        
        // Get playlists for total stats
        const playlists = await Playlist.find({ userId: req.session.userId });
        let totalWatched = 0, totalVideos = 0;
        playlists.forEach(p => {
            totalWatched += p.videos.filter(v => v.completed).length;
            totalVideos += p.videos.length;
        });
        console.log('Playlist totals - watched:', totalWatched, 'total:', totalVideos);
        
        // Generate fresh calendar data
        const calendarData = generateCalendarData(user.learningActivity || []);
        console.log('Generated calendar data length:', calendarData.length);
        if (calendarData.length > 0) {
            console.log('Sample calendar entry:', calendarData[0]);
        }
        
        // Recalculate streak
        const recalculatedStreak = calculateStreakWithReset(user.learningActivity || []);
        console.log('Recalculated streak:', recalculatedStreak);
        
        // Prepare response
        const response = {
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
            calendarData: calendarData
        };
        console.log('Sending response');
        res.json(response);
        
    } catch (error) {
        console.error('[REFRESH ERROR]', error);
        res.status(500).json({ error: error.message });
    }
});

// ===== GET USER STATS =====
router.get('/user-stats', auth, async (req, res) => {
    console.log('\n========== [USER-STATS] ==========');
    try {
        const user = await User.findById(req.session.userId);
        const playlists = await Playlist.find({ userId: req.session.userId });
        
        // Calculate total videos watched across all playlists
        let totalWatched = 0, totalVideos = 0;
        playlists.forEach(p => {
            totalWatched += p.videos.filter(v => v.completed).length;
            totalVideos += p.videos.length;
        });
        console.log('Playlist totals - watched:', totalWatched, 'total:', totalVideos);
        
        // Recalculate streak with proper reset logic
        const recalculatedStreak = calculateStreakWithReset(user.learningActivity || []);
        console.log('Recalculated streak:', recalculatedStreak);
        
        // Update user's streak if it changed
        if (!user.streak || 
            recalculatedStreak.current !== user.streak.current || 
            recalculatedStreak.longest !== user.streak.longest) {
            user.streak = recalculatedStreak;
            await user.save();
            console.log('Updated user streak in DB');
        }
        
        // Generate calendar data
        const calendarData = generateCalendarData(user.learningActivity || []);
        console.log('Generated calendar data length:', calendarData.length);
        if (calendarData.length > 0) {
            console.log('Sample calendar entry:', calendarData[0]);
        }
        
        // Get recent activity (last 7 days)
        const recentActivity = (user.learningActivity || [])
            .sort((a, b) => new Date(b.date) - new Date(a.date))
            .slice(0, 7);
        console.log('Recent activity count:', recentActivity.length);
        
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
        console.error('[USER-STATS ERROR]', error);
        res.status(500).json({ error: error.message });
    }
});

// ===== TRACK VIDEO WATCH =====
router.post('/track-watch', auth, async (req, res) => {
    console.log('\n========== [TRACK-WATCH] ==========');
    console.log('Request body:', req.body);
    const { videoId, watchTimeMinutes, playlistId } = req.body;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
    console.log('Today date string:', todayStr);
    
    try {
        const user = await User.findById(req.session.userId);
        
        if (!user.learningActivity) user.learningActivity = [];
        if (!user.streak) user.streak = { current: 0, longest: 0, lastActive: null };
        if (!user.totalStats) user.totalStats = { totalVideosWatched: 0, totalWatchTimeMinutes: 0, totalActiveDays: 0 };
        
        // Find today's activity or create new
        let todayActivity = user.learningActivity.find(a => a.date === todayStr);
        
        if (!todayActivity) {
            console.log('Creating new activity for today');
            todayActivity = {
                date: todayStr,
                videosWatched: 0,
                watchTimeMinutes: 0,
                videosCompleted: []
            };
            user.learningActivity.push(todayActivity);
            
            // Update streak with reset logic
            const yesterday = new Date(today);
            yesterday.setDate(yesterday.getDate() - 1);
            const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth()+1).padStart(2,'0')}-${String(yesterday.getDate()).padStart(2,'0')}`;
            const wasActiveYesterday = user.learningActivity.some(a => a.date === yesterdayStr);
            
            if (wasActiveYesterday) {
                user.streak.current += 1;
            } else {
                user.streak.current = 1;
            }
            
            user.streak.longest = Math.max(user.streak.longest, user.streak.current);
            user.streak.lastActive = today;
            user.totalStats.totalActiveDays += 1;
            console.log('Streak updated:', user.streak);
        }
        
        // Update today's stats
        todayActivity.watchTimeMinutes += watchTimeMinutes;
        console.log(`Watch time added: ${watchTimeMinutes} min, total today: ${todayActivity.watchTimeMinutes}`);
        
        if (!todayActivity.videosCompleted.includes(videoId)) {
            todayActivity.videosWatched += 1;
            todayActivity.videosCompleted.push(videoId);
            user.totalStats.totalVideosWatched += 1;
            console.log('Video marked as watched. Total today:', todayActivity.videosWatched);
        } else {
            console.log('Video already counted, not incrementing');
        }
        
        user.totalStats.totalWatchTimeMinutes += watchTimeMinutes;
        console.log('Total watch time overall:', user.totalStats.totalWatchTimeMinutes);
        
        await user.save();
        console.log('User saved');
        res.json({ success: true });
        
    } catch (error) {
        console.error('[TRACK-WATCH ERROR]', error);
        res.status(500).json({ error: error.message });
    }
});

// ===== GET USER PROFILE =====
router.get('/profile', auth, async (req, res) => {
    console.log('\n========== [PROFILE] ==========');
    try {
        const user = await User.findById(req.session.userId).select('-password');
        const playlists = await Playlist.find({ userId: req.session.userId });
        
        // Calculate total videos watched
        let totalWatched = 0;
        playlists.forEach(p => {
            totalWatched += p.videos.filter(v => v.completed).length;
        });
        console.log('Profile - total watched:', totalWatched);
        
        // Recalculate streak for profile too
        const recalculatedStreak = calculateStreakWithReset(user.learningActivity || []);
        console.log('Profile streak:', recalculatedStreak);
        
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
        console.error('[PROFILE ERROR]', error);
        res.status(500).json({ error: error.message });
    }
});

// ===== HELPER FUNCTION: Calculate streak with proper reset logic =====
function calculateStreakWithReset(learningActivity) {
    console.log('[STREAK] Calculating streak for', learningActivity.length, 'activities');
    if (!learningActivity || learningActivity.length === 0) {
        console.log('[STREAK] No activity, returning 0');
        return { current: 0, longest: 0 };
    }
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Create a Set of active date strings (direct string comparison)
    const activeDateSet = new Set(learningActivity.map(a => a.date));
    console.log('[STREAK] Active dates set size:', activeDateSet.size);
    
    // Check if user was active today
    const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
    const activeToday = activeDateSet.has(todayStr);
    console.log('[STREAK] Active today?', activeToday);
    
    let currentStreak = 0;
    
    if (activeToday) {
        currentStreak = 1;
        let checkDate = new Date(today);
        while (true) {
            checkDate.setDate(checkDate.getDate() - 1);
            const checkStr = `${checkDate.getFullYear()}-${String(checkDate.getMonth()+1).padStart(2,'0')}-${String(checkDate.getDate()).padStart(2,'0')}`;
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
        const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth()+1).padStart(2,'0')}-${String(yesterday.getDate()).padStart(2,'0')}`;
        const activeYesterday = activeDateSet.has(yesterdayStr);
        
        if (activeYesterday) {
            currentStreak = 1;
            let checkDate = new Date(yesterday);
            while (true) {
                checkDate.setDate(checkDate.getDate() - 1);
                const checkStr = `${checkDate.getFullYear()}-${String(checkDate.getMonth()+1).padStart(2,'0')}-${String(checkDate.getDate()).padStart(2,'0')}`;
                if (activeDateSet.has(checkStr)) {
                    currentStreak++;
                } else {
                    break;
                }
            }
        } else {
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
            const dateStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth()+1).padStart(2,'0')}-${String(currentDate.getDate()).padStart(2,'0')}`;
            if (activeDateSet.has(dateStr)) {
                tempStreak++;
                longestStreak = Math.max(longestStreak, tempStreak);
            } else {
                tempStreak = 0;
            }
            currentDate.setDate(currentDate.getDate() + 1);
        }
    }
    
    longestStreak = Math.max(longestStreak, currentStreak);
    console.log('[STREAK] Result - current:', currentStreak, 'longest:', longestStreak);
    
    return {
        current: currentStreak,
        longest: longestStreak
    };
}

// ===== HELPER FUNCTION: Generate calendar data =====
function generateCalendarData(activity) {
    console.log('[CALENDAR] Generating calendar data from', activity.length, 'activities');
    const calendar = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Create a map for quick lookup using local date string (YYYY/MM/DD)
    const activityMap = new Map();
    activity.forEach(day => {
        const activityDate = new Date(day.date);
        const year = activityDate.getFullYear();
        const month = String(activityDate.getMonth() + 1).padStart(2, '0');
        const dayNum = String(activityDate.getDate()).padStart(2, '0');
        const localDateStr = `${year}/${month}/${dayNum}`;
        activityMap.set(localDateStr, {
            count: day.videosWatched,
            watchTime: day.watchTimeMinutes || 0
        });
    });
    console.log('[CALENDAR] Activity map size:', activityMap.size);
    
    // Generate last 52 weeks (364 days)
    for (let i = 363; i >= 0; i--) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const dayNum = String(date.getDate()).padStart(2, '0');
        const localDateStr = `${year}/${month}/${dayNum}`;
        
        const dayData = activityMap.get(localDateStr);
        const count = dayData ? dayData.count : 0;
        
        let intensity = 0;
        if (count >= 7) intensity = 4;
        else if (count >= 5) intensity = 3;
        else if (count >= 3) intensity = 2;
        else if (count >= 1) intensity = 1;
        
        calendar.push({
            date: localDateStr,
            count: count,
            intensity: intensity
        });
    }
    
    console.log('[CALENDAR] Generated entries, sample:', calendar[0]);
    return calendar;
}

module.exports = router;
