const express = require('express');
const router = express.Router();
const DeepWorkSession = require('../models/DeepWorkSession');
const User = require('../models/User');

const auth = async (req, res, next) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: 'Please login' });
    }
    next();
};

// Start a session
router.post('/start', auth, async (req, res) => {
    try {
        const session = new DeepWorkSession({
            userId: req.session.userId,
            startTime: new Date(),
            taskType: req.body.taskType || 'other',
            taskDescription: req.body.taskDescription || ''
        });
        await session.save();
        res.json({ sessionId: session._id, startTime: session.startTime });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// End a session
router.post('/end/:sessionId', auth, async (req, res) => {
    try {
        const session = await DeepWorkSession.findOne({
            _id: req.params.sessionId,
            userId: req.session.userId
        });
        
        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }
        
        session.endTime = new Date();
        session.durationMinutes = Math.round((session.endTime - session.startTime) / 60000);
        session.interruptions = req.body.interruptions || 0;
        session.focusScore = req.body.focusScore || 100;
        
        await session.save();
        
        // Update user stats
        await updateUserDeepWorkStats(req.session.userId, session);
        
        res.json({ 
            success: true, 
            duration: session.durationMinutes,
            focusScore: session.focusScore
        });
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get weekly stats (for bar chart)
router.get('/weekly-stats', auth, async (req, res) => {
    try {
        const today = new Date();
        const sevenDaysAgo = new Date(today);
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        
        const sessions = await DeepWorkSession.find({
            userId: req.session.userId,
            startTime: { $gte: sevenDaysAgo }
        });
        
        // Group by day
        const dailyStats = [];
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        
        for (let i = 6; i >= 0; i--) {
            const date = new Date(today);
            date.setDate(date.getDate() - i);
            date.setHours(0, 0, 0, 0);
            
            const nextDate = new Date(date);
            nextDate.setDate(date.getDate() + 1);
            
            const daySessions = sessions.filter(s => 
                s.startTime >= date && s.startTime < nextDate
            );
            
            const totalMinutes = daySessions.reduce((sum, s) => sum + (s.durationMinutes || 0), 0);
            const avgFocus = daySessions.length > 0 
                ? Math.round(daySessions.reduce((sum, s) => sum + (s.focusScore || 0), 0) / daySessions.length)
                : 0;
            
            dailyStats.push({
                day: days[date.getDay()],
                date: date.toISOString().split('T')[0],
                minutes: totalMinutes,
                hours: (totalMinutes / 60).toFixed(1),
                sessions: daySessions.length,
                focusScore: avgFocus
            });
        }
        
        res.json(dailyStats);
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get weekly report (for Sunday summary)
router.get('/weekly-report', auth, async (req, res) => {
    try {
        const today = new Date();
        const startOfWeek = new Date(today);
        startOfWeek.setDate(today.getDate() - today.getDay()); // Start on Sunday
        
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 7);
        
        const sessions = await DeepWorkSession.find({
            userId: req.session.userId,
            startTime: { $gte: startOfWeek, $lt: endOfWeek }
        });
        
        const totalMinutes = sessions.reduce((sum, s) => sum + (s.durationMinutes || 0), 0);
        const avgFocus = sessions.length > 0 
            ? Math.round(sessions.reduce((sum, s) => sum + (s.focusScore || 0), 0) / sessions.length)
            : 0;
        
        // Group by task type
        const taskBreakdown = {};
        sessions.forEach(s => {
            const type = s.taskType || 'other';
            if (!taskBreakdown[type]) {
                taskBreakdown[type] = 0;
            }
            taskBreakdown[type] += s.durationMinutes || 0;
        });
        
        const bestDay = findBestDay(sessions);
        
        res.json({
            weekStart: startOfWeek.toISOString().split('T')[0],
            weekEnd: endOfWeek.toISOString().split('T')[0],
            totalHours: (totalMinutes / 60).toFixed(1),
            totalMinutes,
            sessionsCount: sessions.length,
            avgFocusScore: avgFocus,
            taskBreakdown,
            bestDay,
            goal: { target: 1200, achieved: totalMinutes } // 20 hours default
        });
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Helper function
function findBestDay(sessions) {
    if (sessions.length === 0) return null;
    
    const dayTotals = {};
    sessions.forEach(s => {
        const day = s.startTime.toDateString();
        dayTotals[day] = (dayTotals[day] || 0) + (s.durationMinutes || 0);
    });
    
    let bestDay = null;
    let maxMinutes = 0;
    
    for (const [day, minutes] of Object.entries(dayTotals)) {
        if (minutes > maxMinutes) {
            maxMinutes = minutes;
            bestDay = { day, minutes };
        }
    }
    
    return bestDay;
}

// Helper function to update user stats
async function updateUserDeepWorkStats(userId, session) {
    const user = await User.findById(userId);
    
    if (!user.deepWorkStats) {
        user.deepWorkStats = {
            totalSessions: 0,
            totalDeepWorkMinutes: 0,
            currentStreak: 0,
            longestStreak: 0,
            dailyStats: []
        };
    }
    
    user.deepWorkStats.totalSessions += 1;
    user.deepWorkStats.totalDeepWorkMinutes += session.durationMinutes;
    
    // Update daily stats
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    let todayStats = user.deepWorkStats.dailyStats.find(d => 
        new Date(d.date).setHours(0,0,0,0) === today.getTime()
    );
    
    if (!todayStats) {
        todayStats = {
            date: today,
            totalMinutes: 0,
            sessions: 0,
            avgFocusScore: 0
        };
        user.deepWorkStats.dailyStats.push(todayStats);
    }
    
    todayStats.totalMinutes += session.durationMinutes;
    todayStats.sessions += 1;
    
    // Recalculate average focus
    const allTodaySessions = await DeepWorkSession.find({
        userId,
        startTime: { $gte: today, $lt: new Date(today.getTime() + 86400000) }
    });
    
    const totalFocus = allTodaySessions.reduce((sum, s) => sum + (s.focusScore || 0), 0);
    todayStats.avgFocusScore = Math.round(totalFocus / allTodaySessions.length);
    
    // Update streak
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    const hadSessionYesterday = user.deepWorkStats.dailyStats.some(d => 
        new Date(d.date).setHours(0,0,0,0) === yesterday.getTime() && d.totalMinutes > 0
    );
    
    if (hadSessionYesterday) {
        user.deepWorkStats.currentStreak += 1;
    } else {
        user.deepWorkStats.currentStreak = 1;
    }
    
    user.deepWorkStats.longestStreak = Math.max(
        user.deepWorkStats.longestStreak,
        user.deepWorkStats.currentStreak
    );
    
    user.deepWorkStats.lastSessionDate = new Date();
    
    await user.save();
}

module.exports = router;
