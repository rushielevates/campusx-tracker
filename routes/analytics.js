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

// Helper: convert any date input to YYYY-MM-DD string
const toDateString = (dateInput) => {
    const d = new Date(dateInput);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};

// ===== REFRESH ANALYTICS AFTER VIDEO TOGGLE =====
router.post('/refresh', auth, async (req, res) => {
    console.log('\n========== [REFRESH] ==========');
    console.log('Request body:', req.body);
    const { videoId, completed, playlistId } = req.body;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = toDateString(today);
    console.log('Today date string:', todayStr);

    try {
        const user = await User.findById(req.session.userId);
        console.log('User found:', user._id);

        // Initialize arrays if needed
        if (!user.learningActivity) user.learningActivity = [];
        if (!user.streak) user.streak = { current: 0, longest: 0, lastActive: null };
        if (!user.totalStats) user.totalStats = { totalVideosWatched: 0, totalWatchTimeMinutes: 0, totalActiveDays: 0 };

        // --- Find today's activity (handle both Date and string) ---
        let todayActivity = null;
        for (let act of user.learningActivity) {
            const actDateStr = toDateString(act.date); // normalize to string
            if (actDateStr === todayStr) {
                todayActivity = act;
                break;
            }
        }
        console.log('Today activity found?', todayActivity ? 'Yes' : 'No');

        if (!todayActivity) {
            console.log('Creating new activity for today');
            todayActivity = {
                date: todayStr, // store as string
                videosWatched: 0,
                watchTimeMinutes: 0,
                videosCompleted: []
            };
            user.learningActivity.push(todayActivity);

            // Update streak
            const yesterday = new Date(today);
            yesterday.setDate(yesterday.getDate() - 1);
            const yesterdayStr = toDateString(yesterday);
            const wasActiveYesterday = user.learningActivity.some(act => toDateString(act.date) === yesterdayStr);
            console.log('Was active yesterday?', wasActiveYesterday);

            if (wasActiveYesterday) {
                user.streak.current += 1;
            } else {
                user.streak.current = 1;
            }
            user.streak.longest = Math.max(user.streak.longest, user.streak.current);
            user.streak.lastActive = today;
            user.totalStats.totalActiveDays += 1;
            console.log('Updated streak:', user.streak);
        } else {
            console.log('Existing today activity:', todayActivity);
        }

        // --- Update count based on completion status ---
        console.log('Updating activity. Completed?', completed);
        if (completed) {
            if (!todayActivity.videosCompleted.includes(videoId)) {
                todayActivity.videosWatched += 1;
                todayActivity.videosCompleted.push(videoId);
                user.totalStats.totalVideosWatched += 1;
                console.log('Video marked complete. New videosWatched:', todayActivity.videosWatched);
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
            } else {
                console.log('Video was not completed, no change');
            }
        }

        // Clean up old data (keep last 365 days)
        const oneYearAgo = new Date();
        oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
        const originalLength = user.learningActivity.length;
        user.learningActivity = user.learningActivity.filter(act => new Date(act.date) >= oneYearAgo);
        console.log(`Cleaned up learningActivity: ${originalLength} -> ${user.learningActivity.length}`);

        await user.save();
        console.log('User saved successfully');

        // Get playlist totals
        const playlists = await Playlist.find({ userId: req.session.userId });
        let totalWatched = 0, totalVideos = 0;
        playlists.forEach(p => {
            totalWatched += p.videos.filter(v => v.completed).length;
            totalVideos += p.videos.length;
        });

        // Generate calendar data
        const calendarData = generateCalendarData(user.learningActivity || []);
        const recalculatedStreak = calculateStreakWithReset(user.learningActivity || []);

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
            calendarData
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

        let totalWatched = 0, totalVideos = 0;
        playlists.forEach(p => {
            totalWatched += p.videos.filter(v => v.completed).length;
            totalVideos += p.videos.length;
        });

        const recalculatedStreak = calculateStreakWithReset(user.learningActivity || []);
        if (!user.streak || recalculatedStreak.current !== user.streak.current || recalculatedStreak.longest !== user.streak.longest) {
            user.streak = recalculatedStreak;
            await user.save();
            console.log('Updated user streak in DB');
        }

        const calendarData = generateCalendarData(user.learningActivity || []);
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
    const todayStr = toDateString(today);

    try {
        const user = await User.findById(req.session.userId);
        if (!user.learningActivity) user.learningActivity = [];
        if (!user.streak) user.streak = { current: 0, longest: 0, lastActive: null };
        if (!user.totalStats) user.totalStats = { totalVideosWatched: 0, totalWatchTimeMinutes: 0, totalActiveDays: 0 };

        let todayActivity = null;
        for (let act of user.learningActivity) {
            if (toDateString(act.date) === todayStr) {
                todayActivity = act;
                break;
            }
        }

        if (!todayActivity) {
            console.log('Creating new activity for today');
            todayActivity = {
                date: todayStr,
                videosWatched: 0,
                watchTimeMinutes: 0,
                videosCompleted: []
            };
            user.learningActivity.push(todayActivity);

            const yesterday = new Date(today);
            yesterday.setDate(yesterday.getDate() - 1);
            const yesterdayStr = toDateString(yesterday);
            const wasActiveYesterday = user.learningActivity.some(act => toDateString(act.date) === yesterdayStr);
            if (wasActiveYesterday) {
                user.streak.current += 1;
            } else {
                user.streak.current = 1;
            }
            user.streak.longest = Math.max(user.streak.longest, user.streak.current);
            user.streak.lastActive = today;
            user.totalStats.totalActiveDays += 1;
        }

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
        let totalWatched = 0;
        playlists.forEach(p => totalWatched += p.videos.filter(v => v.completed).length);
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
        console.error('[PROFILE ERROR]', error);
        res.status(500).json({ error: error.message });
    }
});

// ===== HELPER FUNCTION: Calculate streak =====
function calculateStreakWithReset(learningActivity) {
    if (!learningActivity || learningActivity.length === 0) return { current: 0, longest: 0 };

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = toDateString(today);

    // Build set of active date strings
    const activeDateSet = new Set(learningActivity.map(act => toDateString(act.date)));

    const activeToday = activeDateSet.has(todayStr);
    let currentStreak = 0;

    if (activeToday) {
        currentStreak = 1;
        let checkDate = new Date(today);
        while (true) {
            checkDate.setDate(checkDate.getDate() - 1);
            const checkStr = toDateString(checkDate);
            if (activeDateSet.has(checkStr)) {
                currentStreak++;
            } else {
                break;
            }
        }
    } else {
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = toDateString(yesterday);
        if (activeDateSet.has(yesterdayStr)) {
            currentStreak = 1;
            let checkDate = new Date(yesterday);
            while (true) {
                checkDate.setDate(checkDate.getDate() - 1);
                const checkStr = toDateString(checkDate);
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

    // Calculate longest streak
    let longestStreak = 0;
    let tempStreak = 0;
    if (learningActivity.length > 0) {
        const dates = learningActivity.map(act => new Date(act.date).setHours(0, 0, 0, 0));
        const minDate = new Date(Math.min(...dates));
        const maxDate = new Date(Math.max(...dates));
        let currentDate = new Date(minDate);
        while (currentDate <= maxDate) {
            const dateStr = toDateString(currentDate);
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

    return { current: currentStreak, longest: longestStreak };
}

// ===== HELPER FUNCTION: Generate calendar data =====
function generateCalendarData(activity) {
    const calendar = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const activityMap = new Map();
    activity.forEach(day => {
        const d = new Date(day.date);
        const localDateStr = `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
        activityMap.set(localDateStr, {
            count: day.videosWatched,
            watchTime: day.watchTimeMinutes || 0
        });
    });

    for (let i = 363; i >= 0; i--) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        const localDateStr = `${date.getFullYear()}/${String(date.getMonth()+1).padStart(2,'0')}/${String(date.getDate()).padStart(2,'0')}`;
        const dayData = activityMap.get(localDateStr);
        const count = dayData ? dayData.count : 0;

        let intensity = 0;
        if (count >= 7) intensity = 4;
        else if (count >= 5) intensity = 3;
        else if (count >= 3) intensity = 2;
        else if (count >= 1) intensity = 1;

        calendar.push({ date: localDateStr, count, intensity });
    }
    return calendar;
}

module.exports = router;
