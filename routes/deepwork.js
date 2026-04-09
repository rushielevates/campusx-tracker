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
// Start a session
router.post('/start', auth, async (req, res) => {
    console.log('🚀 ===== START ENDPOINT HIT =====');
    console.log('Request body:', req.body);
    console.log('User ID from session:', req.session.userId);
    
    try {
        // Step 1: End any existing active sessions
        console.log('📌 Step 1: Ending existing active sessions');
        const updateResult = await DeepWorkSession.updateMany(
            { userId: req.session.userId, activeSession: true },
            { 
                activeSession: false,
                endTime: new Date()
            }
        );
        console.log('✅ Updated sessions:', updateResult);
        
        // Step 2: Create new session
        console.log('📌 Step 2: Creating new session');
        const sessionData = {
            userId: req.session.userId,
            startTime: new Date(),
            taskType: req.body.taskType || 'other',
            taskDescription: req.body.taskDescription || '',
            activeSession: true
        };
        console.log('Session data to save:', sessionData);
        
        const session = new DeepWorkSession(sessionData);
        
        // Step 3: Save to database
        console.log('📌 Step 3: Saving to database');
        await session.save();
        console.log('✅ Session saved with ID:', session._id);
        
        // Step 4: Send response
        console.log('📌 Step 4: Sending response');
        res.json({ 
            sessionId: session._id, 
            startTime: session.startTime 
        });
        
    } catch (error) {
        console.error('❌ ERROR IN START ENDPOINT:');
        console.error('Error name:', error.name);
        console.error('Error message:', error.message);
        console.error('Error stack:', error.stack);
        
        // Check for specific MongoDB errors
        if (error.name === 'ValidationError') {
            console.error('Validation Error details:', error.errors);
            return res.status(500).json({ 
                error: 'Validation failed', 
                details: error.errors 
            });
        }
        
        if (error.name === 'MongoServerError') {
            console.error('MongoDB error code:', error.code);
            console.error('MongoDB error message:', error.errmsg);
        }
        
        res.status(500).json({ 
            error: error.message,
            name: error.name
        });
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
// ===== TASK TYPE MANAGEMENT ENDPOINTS =====

// Get user's custom task types
router.get('/task-types', auth, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        const taskTypes = user.deepWorkStats?.customTaskTypes || [];
        
        res.json({ taskTypes });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Add new task type
router.post('/task-types/add', auth, async (req, res) => {
    try {
        const { name, icon, color } = req.body;
        
        if (!name || name.trim() === '') {
            return res.status(400).json({ error: 'Task type name is required' });
        }
        
        const user = await User.findById(req.session.userId);
        
        if (!user.deepWorkStats) {
            user.deepWorkStats = {};
        }
        if (!user.deepWorkStats.customTaskTypes) {
            user.deepWorkStats.customTaskTypes = [];
        }
        
        // Generate unique ID
        const newId = name.toLowerCase().replace(/\s+/g, '-') + '-' + Date.now();
        
        // Get max order
        const maxOrder = user.deepWorkStats.customTaskTypes.reduce(
            (max, t) => Math.max(max, t.order || 0), 0
        );
        
        const newTaskType = {
            id: newId,
            name: name.trim(),
            icon: icon || '⚙️',
            color: color || '#667eea',
            isActive: true,
            order: maxOrder + 1
        };
        
        user.deepWorkStats.customTaskTypes.push(newTaskType);
        await user.save();
        
        res.json({ 
            success: true, 
            taskType: newTaskType,
            message: 'Task type added successfully'
        });
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Edit task type
router.put('/task-types/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const { name, icon, color, isActive } = req.body;
        
        const user = await User.findById(req.session.userId);
        
        const taskType = user.deepWorkStats?.customTaskTypes?.find(t => t.id === id);
        
        if (!taskType) {
            return res.status(404).json({ error: 'Task type not found' });
        }
        
        if (name) taskType.name = name;
        if (icon) taskType.icon = icon;
        if (color) taskType.color = color;
        if (isActive !== undefined) taskType.isActive = isActive;
        
        await user.save();
        
        res.json({ success: true, taskType });
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete task type
// Delete task type - NOW ALLOWS DELETING ANY TASK
router.delete('/task-types/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        
        const user = await User.findById(req.session.userId);
        
        // REMOVED the default task check - now allows deleting any task
        
        const taskIndex = user.deepWorkStats.customTaskTypes.findIndex(t => t.id === id);
        
        if (taskIndex === -1) {
            return res.status(404).json({ error: 'Task type not found' });
        }
        
        // Remove the task completely
        user.deepWorkStats.customTaskTypes.splice(taskIndex, 1);
        await user.save();
        
        res.json({ success: true, message: 'Task type deleted' });
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Reorder task types
router.post('/task-types/reorder', auth, async (req, res) => {
    try {
        const { orderedIds } = req.body; // Array of task type IDs in new order
        
        const user = await User.findById(req.session.userId);
        
        // Create map of existing tasks
        const taskMap = {};
        user.deepWorkStats.customTaskTypes.forEach(t => {
            taskMap[t.id] = t;
        });
        
        // Reorder based on provided IDs
        const reordered = orderedIds.map((id, index) => {
            return { ...taskMap[id], order: index + 1 };
        });
        
        user.deepWorkStats.customTaskTypes = reordered;
        await user.save();
        
        res.json({ success: true });
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
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
        
        // Get from user.dailyStats (includes manual edits)
        const user = await User.findById(req.session.userId);
        let userTotal = 0;
        if (user.deepWorkStats?.dailyStats) {
            const todayStat = user.deepWorkStats.dailyStats.find(d => {
                const dDate = new Date(d.date);
                dDate.setHours(0, 0, 0, 0);
                return dDate.getTime() === today.getTime();
            });
            userTotal = todayStat?.totalMinutes || 0;
        }
        
        // Get from sessions (for sessions count, focus, etc.)
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        
        const todaySessions = await DeepWorkSession.find({
            userId: req.session.userId,
            startTime: { $gte: today, $lt: tomorrow }
        });
        
        // Calculate session total
        const sessionTotal = todaySessions.reduce((sum, s) => sum + (s.durationMinutes || 0), 0);
        
        // Calculate average focus
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
        
        // PRIORITIZE userTotal if it exists and is greater than 0
        const totalToUse = userTotal > 0 ? userTotal : sessionTotal;
        
        res.json({
            totalMinutes: totalToUse,
            sessions: todaySessions.length,
            avgFocus: avgFocus,
            currentSession: currentSessionSeconds,
            streak: user.deepWorkStats?.currentStreak || 0
        });
        
    } catch (error) {
        console.error('Error in /today-stats:', error);
        res.status(500).json({ error: error.message });
    }
});
// ===== END OF NEW ENDPOINT =====
// Get weekly stats (for bar chart) - UPDATED to use manual edits
// Get weekly stats (for bar chart) - WITH WEEK NAVIGATION
router.get('/weekly-stats', auth, async (req, res) => {
    try {
        // Get week offset from query parameter (0 = current week, -1 = last week, etc.)
        const weekOffset = parseInt(req.query.weekOffset) || 0;
        
        // Calculate the target date based on offset
        const today = new Date();
        const targetDate = new Date(today);
        targetDate.setDate(today.getDate() + (weekOffset * 7));
        
        // Calculate Monday of the target week
        const monday = new Date(targetDate);
        const dayOfWeek = targetDate.getDay(); // 0 = Sunday, 1 = Monday, etc.
        const daysToSubtract = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Adjust to Monday
        monday.setDate(targetDate.getDate() - daysToSubtract);
        monday.setHours(0, 0, 0, 0);
        
        // Calculate Sunday of the week
        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 6);
        sunday.setHours(23, 59, 59, 999);
        
        // Get sessions for this week
        const sessions = await DeepWorkSession.find({
            userId: req.session.userId,
            startTime: { $gte: monday, $lte: sunday }
        });
        
        // Get user's dailyStats (includes manual edits)
        const user = await User.findById(req.session.userId);
        const userDailyStats = user.deepWorkStats?.dailyStats || [];
        
        // Create a map of dates from userDailyStats for quick lookup
        const editedMinutesMap = new Map();
        userDailyStats.forEach(stat => {
            const date = new Date(stat.date);
            date.setHours(0, 0, 0, 0);
            editedMinutesMap.set(date.getTime(), stat.totalMinutes || 0);
        });
        
        // Group by day for the week
        const weeklyData = [];
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        
        for (let i = 0; i < 7; i++) {
            const date = new Date(monday);
            date.setDate(monday.getDate() + i);
            date.setHours(0, 0, 0, 0);
            
            const nextDate = new Date(date);
            nextDate.setDate(date.getDate() + 1);
            
            // Get sessions for this day
            const daySessions = sessions.filter(s => 
                s.startTime >= date && s.startTime < nextDate
            );
            
            // Calculate from sessions
            const sessionMinutes = daySessions.reduce((sum, s) => sum + (s.durationMinutes || 0), 0);
            
            // Get edited minutes from map (if any)
            const editedMinutes = editedMinutesMap.get(date.getTime()) || 0;
            
            // PRIORITIZE edited minutes if they exist
            const totalMinutes = editedMinutes > 0 ? editedMinutes : sessionMinutes;
            
            const avgFocus = daySessions.length > 0 
                ? Math.round(daySessions.reduce((sum, s) => sum + (s.focusScore || 0), 0) / daySessions.length)
                : 0;
            
            weeklyData.push({
                day: days[date.getDay()],
                date: date.toISOString().split('T')[0],
                minutes: totalMinutes,
                hours: (totalMinutes / 60).toFixed(1),
                sessions: daySessions.length,
                focusScore: avgFocus
            });
        }
        
        // Format week range for display
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 
                           'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        
        const weekStartFormatted = `${monthNames[monday.getMonth()]} ${monday.getDate()}`;
        const weekEndFormatted = `${monthNames[sunday.getMonth()]} ${sunday.getDate()}, ${sunday.getFullYear()}`;
        
        res.json({
            weekStart: monday.toISOString().split('T')[0],
            weekEnd: sunday.toISOString().split('T')[0],
            weekRangeDisplay: `${weekStartFormatted} - ${weekEndFormatted}`,
            weekOffset: weekOffset,
            isCurrentWeek: weekOffset === 0,
            data: weeklyData
        });
        
    } catch (error) {
        console.error('Error in weekly-stats:', error);
        res.status(500).json({ error: error.message });
    }
});

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
        
       // Calculate number of days that have passed in the current week
const currentDayIndex = today.getDay(); // 0 = Sunday, 1 = Monday, etc.

// Convert to days passed (Monday = 1, Tuesday = 2, ... Sunday = 7)
let daysPassed;
if (currentDayIndex === 0) { // Sunday
    daysPassed = 7; // Full week
} else {
    daysPassed = currentDayIndex; // Monday=1, Tuesday=2, etc.
}

// Calculate average based on actual days passed
const avgDailyMinutes = Math.round(totalMinutes / daysPassed);
        
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
        
        // Get user's weekly goal
        const user = await User.findById(req.session.userId);
        const weeklyGoal = user.deepWorkStats?.weeklyGoal || 1500;
        
        // Send response with all data INCLUDING goal
        res.json({
            weekStart: monday.toISOString().split('T')[0],
            weekEnd: sunday.toISOString().split('T')[0],
            weekRangeDisplay: `${monthNames[monday.getMonth()]} ${monday.getDate()} - ${monthNames[sunday.getMonth()]} ${sunday.getDate()}, ${sunday.getFullYear()}`,
            totalHours: totalHours,
            totalMinutes: totalMinutes,
            sessionsCount: totalSessions,  // ← ADDED THIS
            avgFocusScore: avgFocus,        // ← ADDED THIS
            avgDailyDisplay: avgDailyDisplay,
            bestDay: bestDay,
            weeklyStreak: weeklyStreak,
            goal: { 
                target: weeklyGoal,
                achieved: totalMinutes,
                percentage: Math.round((totalMinutes / weeklyGoal) * 100)
            }
        });
        
    } catch (error) {
        console.error('Error in weekly report:', error);
        res.status(500).json({ error: error.message });
    }
});
        
// ===== GOAL MANAGEMENT ENDPOINTS =====

// Get user's current goal
router.get('/get-goal', auth, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        const weeklyGoal = user.deepWorkStats?.weeklyGoal || 1500;
        
        res.json({
            weeklyGoal: weeklyGoal,
            weeklyGoalHours: (weeklyGoal / 60).toFixed(1)
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// ===== CATEGORY BREAKDOWN ENDPOINT =====
// ===== CATEGORY BREAKDOWN ENDPOINT =====
router.get('/category-breakdown', auth, async (req, res) => {
    try {
        const today = new Date();
        
        // Calculate Monday of current week
        const monday = new Date(today);
        const dayOfWeek = today.getDay();
        const daysToSubtract = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
        monday.setDate(today.getDate() - daysToSubtract);
        monday.setHours(0, 0, 0, 0);
        
        // Calculate Sunday
        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 6);
        sunday.setHours(23, 59, 59, 999);
        
        // Get all sessions for this week
        const sessions = await DeepWorkSession.find({
            userId: req.session.userId,
            startTime: { $gte: monday, $lte: sunday }
        });
        
        // Get user's custom task types for mapping
        const user = await User.findById(req.session.userId);
        const taskTypes = user.deepWorkStats?.customTaskTypes || [];
        
        // Create a map for quick lookup
        const taskTypeMap = new Map();
        taskTypes.forEach(task => {
            taskTypeMap.set(task.id, {
                name: task.name,
                icon: task.icon || '⚙️'
            });
        });
        
        // Calculate total minutes for the week
        const totalMinutes = sessions.reduce((sum, s) => sum + (s.durationMinutes || 0), 0);
        
        // Group by task type
        const categoryMap = new Map();
        
        sessions.forEach(session => {
            const taskType = session.taskType || 'other';
            const minutes = session.durationMinutes || 0;
            
            // Get task details from map, or use defaults
            const taskDetails = taskTypeMap.get(taskType) || {
                name: taskType,
                icon: '⚙️'
            };
            
            const category = categoryMap.get(taskType) || {
                id: taskType,
                name: taskDetails.name,
                icon: taskDetails.icon,
                minutes: 0
            };
            
            category.minutes += minutes;
            categoryMap.set(taskType, category);
        });
        
        // Convert to array and sort by minutes (descending)
        const categories = Array.from(categoryMap.values())
            .sort((a, b) => b.minutes - a.minutes)
            .map(cat => ({
                ...cat,
                hours: (cat.minutes / 60).toFixed(1),
                percentage: totalMinutes > 0 
                    ? Math.round((cat.minutes / totalMinutes) * 100) 
                    : 0
            }));
        
        res.json({
            totalHours: (totalMinutes / 60).toFixed(1),
            totalMinutes,
            categories
        });
        
    } catch (error) {
        console.error('Error in category breakdown:', error);
        res.status(500).json({ error: error.message });
    }
});

// You can remove the old getIconForTaskType helper function since we're not using it anymore

// Helper function to get icon for task type
function getIconForTaskType(taskType) {
    const iconMap = {
        'coding': '💻',
        'reading': '📚',
        'studying': '🎓',
        'writing': '✍️',
        'planning': '📋',
        'other': '⚙️'
    };
    return iconMap[taskType] || '⚙️';
}
// ===== EDIT TODAY'S STATS (Manual Edit) =====
// ===== EDIT TODAY'S STATS (Manual Edit) - DEBUG VERSION =====
// ===== EDIT TODAY'S STATS (Manual Edit) - FIXED VERSION =====
router.post('/edit-today', auth, async (req, res) => {
    try {
        const { totalMinutes } = req.body;
        console.log('🔵 EDIT REQUEST:', { totalMinutes, userId: req.session.userId });
        
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        
        // Validate
        if (totalMinutes < 0 || totalMinutes > 1440) {
            return res.status(400).json({ error: 'Time must be between 0 and 24 hours' });
        }
        
        const user = await User.findById(req.session.userId);
        
        // Find or create today's stats
        let todayStats = null;
        let todayIndex = -1;
        
        if (user.deepWorkStats?.dailyStats) {
            for (let i = 0; i < user.deepWorkStats.dailyStats.length; i++) {
                const stat = user.deepWorkStats.dailyStats[i];
                const statDate = new Date(stat.date);
                statDate.setHours(0, 0, 0, 0);
                
                if (statDate.getTime() === today.getTime()) {
                    todayStats = stat;
                    todayIndex = i;
                    break;
                }
            }
        }
        
        const oldMinutes = todayStats?.totalMinutes || 0;
        const difference = totalMinutes - oldMinutes;
        
        // Get existing sessions for today
        const existingSessions = await DeepWorkSession.find({
            userId: req.session.userId,
            startTime: { $gte: today, $lt: tomorrow }
        });
        
        const existingTotal = existingSessions.reduce((sum, s) => sum + (s.durationMinutes || 0), 0);
        
        // If user wants more time than existing sessions, create a manual session
        if (totalMinutes > existingTotal) {
            const additionalMinutes = totalMinutes - existingTotal;
            
            // Create a manual adjustment session
            const manualSession = new DeepWorkSession({
                userId: req.session.userId,
                startTime: new Date(today.getTime() + 12 * 60 * 60 * 1000), // Noon
                endTime: new Date(today.getTime() + 12 * 60 * 60 * 1000 + additionalMinutes * 60 * 1000),
                durationMinutes: additionalMinutes,
                taskType: 'other',
                taskDescription: 'Manual time adjustment',
                focusScore: 90,
                interruptions: 0,
                activeSession: false,
                isManualEntry: true
            });
            
            await manualSession.save();
            console.log('✅ Created manual session:', manualSession._id, 'with', additionalMinutes, 'minutes');
        }
        
        // If user wants less time, we can't delete sessions (would lose data)
        // Instead, we'll just update the dailyStats and let the discrepancy exist
        // The weekly report will show the actual session total
        
        // Update dailyStats
        if (!todayStats) {
            if (!user.deepWorkStats) user.deepWorkStats = { dailyStats: [] };
            if (!user.deepWorkStats.dailyStats) user.deepWorkStats.dailyStats = [];
            
            user.deepWorkStats.dailyStats.push({
                date: today,
                totalMinutes: totalMinutes,
                sessions: existingSessions.length || 1,
                avgFocusScore: 90,
                isManualEntry: true,
                lastEdited: new Date()
            });
        } else {
            user.deepWorkStats.dailyStats[todayIndex].totalMinutes = totalMinutes;
            user.deepWorkStats.dailyStats[todayIndex].isManualEntry = true;
            user.deepWorkStats.dailyStats[todayIndex].lastEdited = new Date();
        }
        
        // Update total minutes
        if (!user.deepWorkStats.totalDeepWorkMinutes) user.deepWorkStats.totalDeepWorkMinutes = 0;
        user.deepWorkStats.totalDeepWorkMinutes += difference;
        
        user.markModified('deepWorkStats');
        await user.save();
        
        res.json({ 
            success: true, 
            newTotal: totalMinutes,
            message: 'Today\'s time updated'
        });
        
    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({ error: error.message });
    }
});
// Set user's weekly goal
router.post('/set-goal', auth, async (req, res) => {
    try {
        const { weeklyGoalMinutes } = req.body;
        
        // Validate (between 1 and 100 hours)
        if (weeklyGoalMinutes < 60 || weeklyGoalMinutes > 6000) {
            return res.status(400).json({ error: 'Goal must be between 1 and 100 hours' });
        }
        
        const user = await User.findById(req.session.userId);
        
        if (!user.deepWorkStats) {
            user.deepWorkStats = {};
        }
        
        user.deepWorkStats.weeklyGoal = weeklyGoalMinutes;
        await user.save();
        
        res.json({ 
            success: true, 
            weeklyGoal: weeklyGoalMinutes,
            weeklyGoalHours: (weeklyGoalMinutes / 60).toFixed(1)
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
    
    // Update daily stats - FIXED VERSION
const today = new Date();
today.setHours(0, 0, 0, 0);

// More robust way to find today's stats
let todayStats = null;
let todayIndex = -1;

console.log('🔍 Looking for today stats. Total entries:', user.deepWorkStats.dailyStats?.length || 0);

if (user.deepWorkStats.dailyStats) {
    for (let i = 0; i < user.deepWorkStats.dailyStats.length; i++) {
        const stat = user.deepWorkStats.dailyStats[i];
        const statDate = new Date(stat.date);
        statDate.setHours(0, 0, 0, 0);
        
        // Compare timestamps (more reliable)
        if (statDate.getTime() === today.getTime()) {
            todayStats = stat;
            todayIndex = i;
            console.log('✅ Found existing entry at index', i, 'with minutes:', stat.totalMinutes);
            break;
        }
    }
}

if (!todayStats) {
    console.log('⚠️ Creating NEW entry for today');
    todayStats = {
        date: today,
        totalMinutes: session.durationMinutes,  // Initialize with this session's time
        sessions: 1,
        avgFocusScore: 0
    };
    user.deepWorkStats.dailyStats.push(todayStats);
} else {
    // Found existing entry - ADD to it
    console.log('➕ Adding', session.durationMinutes, 'minutes to existing', todayStats.totalMinutes);
    todayStats.totalMinutes += session.durationMinutes;
    todayStats.sessions += 1;
}
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
