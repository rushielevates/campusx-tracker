const express = require('express');
const router = express.Router();
const User = require('../models/User');
const DeepWorkSession = require('../models/DeepWorkSession');

// Auth middleware
const auth = async (req, res, next) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: 'Please login' });
    }
    next();
};

// ===== GET DEEP WORK ANALYTICS =====
router.get('/user-stats', auth, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        const sessions = await DeepWorkSession.find({
            userId: req.session.userId,
            durationMinutes: { $gt: 0 }
        }).sort({ startTime: 1 });

        const dailyMinutesMap = buildDailyMinutesMap(user, sessions);
        const calendarData = generateCalendarData(dailyMinutesMap);
        const totalMinutes = Array.from(dailyMinutesMap.values()).reduce((sum, minutes) => sum + minutes, 0);
        const activeDays = Array.from(dailyMinutesMap.values()).filter(minutes => minutes > 0).length;
        const avgDailyMinutes = activeDays > 0 ? Math.round(totalMinutes / activeDays) : 0;
        const avgFocusScore = calculateAverageFocus(sessions);

        res.json({
            streak: {
                current: user.deepWorkStats?.currentStreak || 0,
                longest: user.deepWorkStats?.longestStreak || 0,
                lastActive: user.deepWorkStats?.lastSessionDate || null
            },
            totalStats: {
                totalDeepWorkMinutes: totalMinutes,
                totalDeepWorkHours: Number((totalMinutes / 60).toFixed(1)),
                totalSessions: sessions.length,
                activeDays,
                avgDailyMinutes,
                avgFocusScore
            },
            calendarData
        });
    } catch (error) {
        console.error('Error fetching deep work analytics:', error);
        res.status(500).json({ error: error.message });
    }
});

// Kept for older frontend calls. Video completion no longer drives analytics.
router.post('/refresh', auth, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        const sessions = await DeepWorkSession.find({
            userId: req.session.userId,
            durationMinutes: { $gt: 0 }
        }).sort({ startTime: 1 });

        const dailyMinutesMap = buildDailyMinutesMap(user, sessions);
        res.json({
            success: true,
            calendarData: generateCalendarData(dailyMinutesMap)
        });
    } catch (error) {
        console.error('Analytics refresh error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ===== GET USER PROFILE =====
router.get('/profile', auth, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId).select('-password');
        const sessions = await DeepWorkSession.find({
            userId: req.session.userId,
            durationMinutes: { $gt: 0 }
        });

        const totalMinutes = sessions.reduce((sum, session) => sum + (session.durationMinutes || 0), 0);

        res.json({
            username: user.username,
            email: user.email,
            createdAt: user.createdAt,
            stats: {
                totalDeepWorkMinutes: totalMinutes,
                totalDeepWorkHours: Number((totalMinutes / 60).toFixed(1)),
                totalSessions: sessions.length,
                currentStreak: user.deepWorkStats?.currentStreak || 0,
                longestStreak: user.deepWorkStats?.longestStreak || 0
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

function buildDailyMinutesMap(user, sessions) {
    const dailyMinutesMap = new Map();

    sessions.forEach(session => {
        const key = toDateKey(session.startTime);
        dailyMinutesMap.set(key, (dailyMinutesMap.get(key) || 0) + (session.durationMinutes || 0));
    });

    // Manual edits in deepWorkStats.dailyStats are the user's intended daily totals.
    // Deep Work stores these as local calendar days, so use local date parts here.
    (user.deepWorkStats?.dailyStats || []).forEach(stat => {
        const key = toDateKey(stat.date);
        dailyMinutesMap.set(key, stat.totalMinutes || 0);
    });

    return dailyMinutesMap;
}

function generateCalendarData(dailyMinutesMap) {
    const calendar = [];
    const today = new Date();

    for (let i = 364; i >= 0; i--) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        date.setHours(0, 0, 0, 0);

        const dateKey = toDateKey(date);
        const minutes = dailyMinutesMap.get(dateKey) || 0;
        const hours = minutes / 60;

        let intensity = 0;
        if (hours >= 4) intensity = 4;
        else if (hours >= 2) intensity = 3;
        else if (hours >= 1) intensity = 2;
        else if (minutes > 0) intensity = 1;

        calendar.push({
            date: dateKey,
            minutes,
            hours: Number(hours.toFixed(2)),
            intensity
        });
    }

    return calendar;
}

function calculateAverageFocus(sessions) {
    const sessionsWithFocus = sessions.filter(session => typeof session.focusScore === 'number');
    if (sessionsWithFocus.length === 0) return 0;

    const totalFocus = sessionsWithFocus.reduce((sum, session) => sum + session.focusScore, 0);
    return Math.round(totalFocus / sessionsWithFocus.length);
}

function toDateKey(value) {
    const date = new Date(value);
    date.setHours(0, 0, 0, 0);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

module.exports = router;
