const express = require('express');
const router = express.Router();
const DeepWorkSession = require('../models/DeepWorkSession');
const User = require('../models/User');

const auth = async (req, res, next) => {
    console.log('DeepWork Auth Check - Session ID:', req.session?.id);
    console.log('DeepWork Auth Check - User ID:', req.session?.userId);
    if (!req.session || !req.session.userId) {
        console.log('❌ DeepWork Auth Failed - No session or userId');
        return res.status(401).json({ error: 'Please login' });
    }
    console.log('✅ DeepWork Auth Successful for user:', req.session.userId);
    next();
};

// Start a session
router.post('/start', auth, async (req, res) => {
    try {
                // End any existing active sessions
        await DeepWorkSession.updateMany(
            { userId: req.session.userId, activeSession: true },
            { 
                activeSession: false,
                endTime: new Date()
                
            }
        );
        const session = new DeepWorkSession({
            userId: req.session.userId,
            startTime: new Date(),
            taskType: req.body.taskType || 'other',
            taskDescription: req.body.taskDescription || '',
            activeSession: true
        });
        await session.save();
        res.json({ sessionId: session._id, startTime: session.startTime });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// Ping endpoint to keep session alive
router.post('/ping', auth, async (req, res) => {
    try {
        const { sessionId } = req.body;
        await DeepWorkSession.findByIdAndUpdate(sessionId, {
            lastPingTime: new Date()
        });
        res.json({ success: true });
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
         const duration = req.body.duration || 
            Math.floor((Date.now() - session.startTime) / 60000);
        
        session.endTime = new Date();
        session.durationMinutes = duration;
        session.interruptions = req.body.interruptions || 0;
        session.focusScore = req.body.focusScore || 100;
        session.activeSession = false;  // ← Clear active flag
        
        await session.save();
        
        // Update user stats
        await updateUserDeepWorkStats(req.session.userId, session);
        
        res.json({ 
            success: true, 
            duration: session.durationMinutes,
            focusScore: session.focusScore
        });
        
    } catch (error) {
        console.error('Error ending session:', error);
        res.status(500).json({ error: error.message });
    }
});

// Add this temporary test route
router.get('/test-auth', auth, (req, res) => {
    res.json({ 
        message: 'Auth working!', 
        userId: req.session.userId,
        sessionId: req.session.id 
    });
});
// Get current active session
router.get('/current-session', auth, async (req, res) => {
    try {
        const activeSession = await DeepWorkSession.findOne({
            userId: req.session.userId,
            activeSession: true,
            endTime: null
        }).sort({ startTime: -1 });
        
        if (activeSession) {
            // Calculate elapsed time
            const elapsedSeconds = Math.floor((Date.now() - activeSession.startTime) / 1000);
            res.json({
                hasActiveSession: true,
                sessionId: activeSession._id,
                startTime: activeSession.startTime,
                elapsedSeconds: elapsedSeconds,
                taskType: activeSession.taskType,
                taskDescription: activeSession.taskDescription
            });
        } else {
            res.json({ hasActiveSession: false });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// ===== ADD THIS NEW ENDPOINT HERE =====
// Get today's stats
router.get('/today-stats', auth, async (req, res) => {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        
        const todaySessions = await DeepWorkSession.find({
            userId: req.session.userId,
            startTime: { $gte: today, $lt: tomorrow }
        });
        
        const totalMinutes = todaySessions.reduce((sum, s) => sum + (s.durationMinutes || 0), 0);
        const avgFocus = todaySessions.length > 0
            ? Math.round(todaySessions.reduce((sum, s) => sum + (s.focusScore || 0), 0) / todaySessions.length)
            : 0;
        
        // Get current active session
        const activeSession = await DeepWorkSession.findOne({
            userId: req.session.userId,
            activeSession: true
        });
        
        const currentSessionSeconds = activeSession 
            ? Math.floor((Date.now() - activeSession.startTime) / 1000)
            : 0;
        
        // Get user for streak
        const user = await User.findById(req.session.userId);
        const streak = user.deepWorkStats?.currentStreak || 0;
        
        res.json({
            totalMinutes,
            sessions: todaySessions.length,
            avgFocus,
            currentSession: currentSessionSeconds,
            streak
        });
        
    } catch (error) {
        console.error('Error in /today-stats:', error);
        res.status(500).json({ error: error.message });
    }
});
// ===== END OF NEW ENDPOINT =====
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
// Get weekly report (for Sunday summary)
// Get weekly report (for Sunday summary)
router.get('/weekly-report', auth, async (req, res) => {
    try {
        const today = new Date();
        
        // Calculate Monday of current week (assuming week starts Monday)
        const monday = new Date(today);
        const dayOfWeek = today.getDay(); // 0 = Sunday, 1 = Monday, etc.
        const daysToSubtract = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Adjust to Monday
        monday.setDate(today.getDate() - daysToSubtract);
        monday.setHours(0, 0, 0, 0);
        
        // Calculate Sunday (end of week)
        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 6);
        sunday.setHours(23, 59, 59, 999);
        
        // Get all sessions for this week
        const sessions = await DeepWorkSession.find({
            userId: req.session.userId,
            startTime: { $gte: monday, $lte: sunday }
        });
        
        // Calculate totals
        const totalMinutes = sessions.reduce((sum, s) => sum + (s.durationMinutes || 0), 0);
        const totalHours = (totalMinutes / 60).toFixed(1);
        const totalSessions = sessions.length;
        
        // Calculate average PER DAY (total minutes / 7 days)
        const avgDailyMinutes = Math.round(totalMinutes / 7);
        
        // Format for display
        const avgDailyHours = Math.floor(avgDailyMinutes / 60);
        const avgDailyMins = avgDailyMinutes % 60;
        const avgDailyDisplay = avgDailyHours > 0 
            ? `${avgDailyHours}h ${avgDailyMins}m` 
            : `${avgDailyMins}m`;
        
        // Calculate average focus score
        const avgFocus = sessions.length > 0 
            ? Math.round(sessions.reduce((sum, s) => sum + (s.focusScore || 0), 0) / sessions.length)
            : 0;
        
        // Find best day
        let bestDay = null;
        let maxMinutes = 0;
        
        if (sessions.length > 0) {
            const dayTotals = {};
            sessions.forEach(s => {
                const dateStr = s.startTime.toDateString();
                dayTotals[dateStr] = (dayTotals[dateStr] || 0) + (s.durationMinutes || 0);
            });
            
            for (const [dateStr, minutes] of Object.entries(dayTotals)) {
                if (minutes > maxMinutes) {
                    maxMinutes = minutes;
                    const date = new Date(dateStr);
                    const dayName = date.toLocaleDateString('en-US', { weekday: 'long' });
                    const monthDay = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                    
                    bestDay = {
                        dayName,
                        date: monthDay,
                        hours: (minutes / 60).toFixed(1),
                        minutes,
                        formatted: `${dayName}, ${monthDay} · ${Math.floor(minutes/60)}h ${minutes%60}m`
                    };
                }
            }
        }
        
        // Calculate weekly streak (consecutive days with sessions)
        let weeklyStreak = 0;
        if (sessions.length > 0) {
            const daysWithSessions = new Set();
            sessions.forEach(s => {
                const dateStr = s.startTime.toDateString();
                daysWithSessions.add(dateStr);
            });
            
            // Check consecutive days from Monday
            let currentDate = new Date(monday);
            while (currentDate <= sunday) {
                const dateStr = currentDate.toDateString();
                if (daysWithSessions.has(dateStr)) {
                    weeklyStreak++;
                } else {
                    break; // Break on first day without session
                }
                currentDate.setDate(currentDate.getDate() + 1);
            }
        }
        
        // Format week range for display
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 
                           'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        
        res.json({
            weekStart: monday.toISOString().split('T')[0],
            weekEnd: sunday.toISOString().split('T')[0],
            weekRangeDisplay: `${monthNames[monday.getMonth()]} ${monday.getDate()} - ${monthNames[sunday.getMonth()]} ${sunday.getDate()}, ${sunday.getFullYear()}`,
            totalHours: totalHours,
            totalMinutes: totalMinutes,
            sessionsCount: totalSessions,  // ← FIXED: Use totalSessions
            avgFocusScore: avgFocus,
            avgDailyMinutes: avgDailyMinutes,
            avgDailyDisplay: avgDailyDisplay,
            bestDay: bestDay,
            weeklyStreak: weeklyStreak,
            goal: { 
                target: 1500, // 25 hours in minutes
                achieved: totalMinutes,
                percentage: Math.round((totalMinutes / 1500) * 100)
            }
        });
        
    } catch (error) {
        console.error('Error in weekly report:', error);
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
   // ===== FIXED STREAK UPDATE CODE =====
// Update streak - ONLY ONCE PER DAY
const yesterday = new Date(today);
yesterday.setDate(yesterday.getDate() - 1);

// Check if this is the first session of the day
const isFirstSessionToday = todayStats.sessions === 1;

if (isFirstSessionToday) {
    const hadSessionYesterday = user.deepWorkStats.dailyStats.some(d => 
        new Date(d.date).setHours(0,0,0,0) === yesterday.getTime() && d.totalMinutes > 0
    );
    
    if (hadSessionYesterday) {
        user.deepWorkStats.currentStreak += 1;
    } else {
        user.deepWorkStats.currentStreak = 1;
    }
}
// ===== END OF FIXED CODE =====
    
    user.deepWorkStats.longestStreak = Math.max(
        user.deepWorkStats.longestStreak,
        user.deepWorkStats.currentStreak
    );
    
    user.deepWorkStats.lastSessionDate = new Date();
    
    await user.save();
}

module.exports = router;
