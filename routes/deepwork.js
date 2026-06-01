const express = require('express');
const router = express.Router();
const DeepWorkSession = require('../models/DeepWorkSession');
const User = require('../models/User');

const APP_TIME_ZONE = 'Asia/Kolkata';
const APP_TIME_ZONE_OFFSET_MINUTES = 330;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_WEEKLY_GOAL_MINUTES = 1500;

function toAppDateKey(date) {
    return new Date(date.getTime() + APP_TIME_ZONE_OFFSET_MINUTES * 60000)
        .toISOString()
        .split('T')[0];
}

function appDateKeyToUtcStart(dateKey) {
    return new Date(`${dateKey}T00:00:00+05:30`);
}

function addDaysToDateKey(dateKey, days) {
    return toAppDateKey(new Date(appDateKeyToUtcStart(dateKey).getTime() + days * DAY_MS));
}

function getAppDayOfWeek(dateKey) {
    return new Date(appDateKeyToUtcStart(dateKey).getTime() + APP_TIME_ZONE_OFFSET_MINUTES * 60000).getUTCDay();
}

function getSessionEffectiveEnd(session) {
    const startTime = new Date(session.startTime);
    let endTime = session.endTime ? new Date(session.endTime) : null;

    if (!endTime && session.activeSession) {
        endTime = new Date();
    }

    if ((!endTime || endTime <= startTime) && session.durationMinutes > 0) {
        endTime = new Date(startTime.getTime() + session.durationMinutes * 60000);
    }

    return endTime || startTime;
}

function minutesFromAppDayStart(date) {
    const localDate = new Date(date.getTime() + APP_TIME_ZONE_OFFSET_MINUTES * 60000);
    return localDate.getUTCHours() * 60 + localDate.getUTCMinutes() + (localDate.getUTCSeconds() / 60);
}

function formatTimeFromMinutes(minutes) {
    if (Math.round(minutes) >= 1440) return '12:00 AM';
    const normalized = ((Math.round(minutes) % 1440) + 1440) % 1440;
    const hours24 = Math.floor(normalized / 60);
    const mins = normalized % 60;
    const period = hours24 >= 12 ? 'PM' : 'AM';
    const hours12 = hours24 % 12 || 12;
    return `${hours12}:${mins.toString().padStart(2, '0')} ${period}`;
}

function getWeekBoundsForOffset(weekOffset = 0) {
    const { mondayDateKey, sundayDateKey } = getWeekDateKeysForOffset(weekOffset);
    return {
        monday: appDateKeyToUtcStart(mondayDateKey),
        sunday: new Date(appDateKeyToUtcStart(addDaysToDateKey(sundayDateKey, 1)).getTime() - 1),
        mondayDateKey,
        sundayDateKey
    };
}

function getWeekDateKeysForOffset(weekOffset = 0) {
    const todayDateKey = toAppDateKey(new Date());
    const targetDateKey = addDaysToDateKey(todayDateKey, weekOffset * 7);
    const dayOfWeek = getAppDayOfWeek(targetDateKey);
    const daysToSubtract = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const mondayDateKey = addDaysToDateKey(targetDateKey, -daysToSubtract);
    const sundayDateKey = addDaysToDateKey(mondayDateKey, 6);

    return { mondayDateKey, sundayDateKey };
}

function normalizeWeekStartKey(weekStart) {
    if (typeof weekStart === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
        return weekStart;
    }

    if (weekStart) {
        const parsed = new Date(weekStart);
        if (!Number.isNaN(parsed.getTime())) return toAppDateKey(parsed);
    }

    return null;
}

function getGoalForWeek(user, weekStartKey) {
    const savedGoal = user.deepWorkStats?.weeklyGoals?.find(goal => {
        return normalizeWeekStartKey(goal.weekStart) === weekStartKey;
    });

    if (savedGoal?.goalMinutes) {
        return savedGoal.goalMinutes;
    }

    if (user.deepWorkStats?.goalWeekStart && user.deepWorkStats?.weeklyGoal) {
        if (normalizeWeekStartKey(user.deepWorkStats.goalWeekStart) === weekStartKey) {
            return user.deepWorkStats.weeklyGoal;
        }
    }

    return DEFAULT_WEEKLY_GOAL_MINUTES;
}

function fallbackTaskName(taskType) {
    if (!taskType) return 'Study';
    const withoutTimestamp = String(taskType).replace(/-\d{8,}$/, '');
    return withoutTimestamp
        .split('-')
        .filter(Boolean)
        .map(part => {
            const lower = part.toLowerCase();
            if (['dsa', 'sql', 'ml', 'ai'].includes(lower)) return lower.toUpperCase();
            return lower.charAt(0).toUpperCase() + lower.slice(1);
        })
        .join(' ') || 'Study';
}

function getTaskTypeDetailsMap(taskTypes = []) {
    const taskTypeMap = new Map();
    taskTypes.forEach(task => {
        taskTypeMap.set(task.id, {
            name: task.name,
            icon: task.icon || '⚙️',
            color: task.color || '#667eea'
        });
    });
    return taskTypeMap;
}

function buildSessionSegmentsForWeek(sessions, weekStartDateKey, taskTypes = []) {
    const taskTypeMap = getTaskTypeDetailsMap(taskTypes);
    const segmentsByDate = new Map();

    for (let i = 0; i < 7; i++) {
        segmentsByDate.set(addDaysToDateKey(weekStartDateKey, i), []);
    }

    sessions.forEach(session => {
        const startTime = new Date(session.startTime);
        const effectiveEnd = getSessionEffectiveEnd(session);

        if (effectiveEnd <= startTime) return;

        let currentDateKey = toAppDateKey(startTime);
        const lastDateKey = toAppDateKey(new Date(effectiveEnd.getTime() - 1));
        const taskType = session.taskType || 'other';
        const taskDetails = taskTypeMap.get(taskType) || {
            name: fallbackTaskName(taskType),
            icon: '⚙️',
            color: '#667eea'
        };

        while (currentDateKey <= lastDateKey) {
            if (segmentsByDate.has(currentDateKey)) {
                const dayStart = appDateKeyToUtcStart(currentDateKey);
                const dayEnd = new Date(dayStart.getTime() + DAY_MS);
                const segmentStart = new Date(Math.max(startTime.getTime(), dayStart.getTime()));
                const segmentEnd = new Date(Math.min(effectiveEnd.getTime(), dayEnd.getTime()));
                const isWholeSessionSegment = segmentStart.getTime() === startTime.getTime() &&
                    segmentEnd.getTime() === effectiveEnd.getTime();
                const minutes = isWholeSessionSegment && session.durationMinutes > 0
                    ? session.durationMinutes
                    : Math.max(0, Math.round((segmentEnd - segmentStart) / 60000));

                if (minutes > 0) {
                    const startsAtDayStart = segmentStart.getTime() === dayStart.getTime();
                    const endsAtDayEnd = segmentEnd.getTime() === dayEnd.getTime();
                    const startMinute = startsAtDayStart ? 0 : minutesFromAppDayStart(segmentStart);
                    const endMinute = endsAtDayEnd ? 1440 : minutesFromAppDayStart(segmentEnd);

                    segmentsByDate.get(currentDateKey).push({
                        id: session._id.toString(),
                        taskType,
                        taskName: taskDetails.name,
                        taskIcon: taskDetails.icon,
                        color: taskDetails.color,
                        taskDescription: session.taskDescription || taskDetails.name,
                        startMinute,
                        endMinute,
                        startTime: segmentStart.toISOString(),
                        endTime: segmentEnd.toISOString(),
                        startLabel: formatTimeFromMinutes(startMinute),
                        endLabel: formatTimeFromMinutes(endMinute),
                        minutes,
                        hours: (minutes / 60).toFixed(1),
                        isManual: session.isManualEntry || false,
                        isActive: session.activeSession || false
                    });
                }
            }

            currentDateKey = addDaysToDateKey(currentDateKey, 1);
        }
    });

    for (const segments of segmentsByDate.values()) {
        segments.sort((a, b) => a.startMinute - b.startMinute);
    }

    return segmentsByDate;
}

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
        
        // Calculate the target week in India time. Sessions are stored as UTC dates,
        // but all chart buckets should represent the user's local day.
        const todayDateKey = toAppDateKey(new Date());
        const targetDateKey = addDaysToDateKey(todayDateKey, weekOffset * 7);
        const dayOfWeek = getAppDayOfWeek(targetDateKey); // 0 = Sunday, 1 = Monday, etc.
        const daysToSubtract = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
        const mondayDateKey = addDaysToDateKey(targetDateKey, -daysToSubtract);
        const sundayDateKey = addDaysToDateKey(mondayDateKey, 6);
        const monday = appDateKeyToUtcStart(mondayDateKey);
        const sundayEnd = new Date(appDateKeyToUtcStart(addDaysToDateKey(sundayDateKey, 1)).getTime() - 1);
        
        // Get sessions overlapping this week. This includes sessions that start before
        // midnight and continue into a visible India-time day.
        const sessions = await DeepWorkSession.find({
            userId: req.session.userId,
            startTime: { $lte: sundayEnd },
            $or: [
                { endTime: { $gte: monday } },
                { endTime: null },
                { activeSession: true }
            ]
        });
        
        // Get user's dailyStats (includes manual edits)
        const user = await User.findById(req.session.userId);
        const userDailyStats = user.deepWorkStats?.dailyStats || [];
        const taskTypes = user.deepWorkStats?.customTaskTypes || [];
        const segmentsByDate = buildSessionSegmentsForWeek(sessions, mondayDateKey, taskTypes);
        
        // Create a map of dates from userDailyStats for quick lookup
        const editedMinutesMap = new Map();
        userDailyStats.forEach(stat => {
            editedMinutesMap.set(toAppDateKey(new Date(stat.date)), stat.totalMinutes || 0);
        });
        
        // Group by day for the week
        const weeklyData = [];
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        
        for (let i = 0; i < 7; i++) {
            const dateKey = addDaysToDateKey(mondayDateKey, i);
            const date = appDateKeyToUtcStart(dateKey);
            const nextDate = appDateKeyToUtcStart(addDaysToDateKey(dateKey, 1));
            
            // Get sessions for this day
            const daySessions = sessions.filter(s => {
                const sessionStart = new Date(s.startTime);
                const sessionEnd = getSessionEffectiveEnd(s);
                return sessionStart < nextDate && sessionEnd > date;
            });
            
            // Calculate from sessions
            const daySegments = segmentsByDate.get(dateKey) || [];
            const sessionMinutes = daySegments.reduce((sum, segment) => sum + (segment.minutes || 0), 0);
            
            // Get edited minutes from map (if any)
            const editedMinutes = editedMinutesMap.get(dateKey) || 0;
            
            // PRIORITIZE edited minutes if they exist
            const totalMinutes = editedMinutes > 0 ? editedMinutes : sessionMinutes;

            const avgFocus = daySessions.length > 0 
                ? Math.round(daySessions.reduce((sum, s) => sum + (s.focusScore || 0), 0) / daySessions.length)
                : 0;
            
            weeklyData.push({
                day: days[getAppDayOfWeek(dateKey)],
                date: dateKey,
                minutes: totalMinutes,
                hours: (totalMinutes / 60).toFixed(1),
                sessions: daySessions.length,
                focusScore: avgFocus,
                segments: daySegments
            });
        }
        
        // Format week range for display
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 
                           'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        
        const mondayLocal = new Date(monday.getTime() + APP_TIME_ZONE_OFFSET_MINUTES * 60000);
        const sundayLocal = new Date(appDateKeyToUtcStart(sundayDateKey).getTime() + APP_TIME_ZONE_OFFSET_MINUTES * 60000);
        const weekStartFormatted = `${monthNames[mondayLocal.getUTCMonth()]} ${mondayLocal.getUTCDate()}`;
        const weekEndFormatted = `${monthNames[sundayLocal.getUTCMonth()]} ${sundayLocal.getUTCDate()}, ${sundayLocal.getUTCFullYear()}`;
        
        res.json({
            weekStart: mondayDateKey,
            weekEnd: sundayDateKey,
            weekRangeDisplay: `${weekStartFormatted} - ${weekEndFormatted}`,
            weekOffset: weekOffset,
            isCurrentWeek: weekOffset === 0,
            timeZone: APP_TIME_ZONE,
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
        const weekOffset = parseInt(req.query.weekOffset) || 0;
        const { monday, sunday, mondayDateKey, sundayDateKey } = getWeekBoundsForOffset(weekOffset);
        
        // Get all sessions for this week
        const sessions = await DeepWorkSession.find({
            userId: req.session.userId,
            startTime: { $gte: monday, $lte: sunday }
        });
        
        // Calculate totals
        const totalMinutes = sessions.reduce((sum, s) => sum + (s.durationMinutes || 0), 0);
        const totalHours = (totalMinutes / 60).toFixed(1);
        const totalSessions = sessions.length;
        
        const todayDateKey = toAppDateKey(new Date());
        let avgDivisor = 7;

        if (weekOffset === 0) {
            const currentDayIndex = getAppDayOfWeek(todayDateKey);
            avgDivisor = currentDayIndex === 0 ? 7 : currentDayIndex;
        } else if (weekOffset > 0) {
            avgDivisor = 0;
        }

        const avgDailyMinutes = avgDivisor > 0 ? Math.round(totalMinutes / avgDivisor) : 0;
        
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
        const weeklyGoal = getGoalForWeek(user, mondayDateKey);
        
        // Send response with all data INCLUDING goal
        res.json({
            weekStart: mondayDateKey,
            weekEnd: sundayDateKey,
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

// ===== GET TODAY'S CATEGORY BREAKDOWN FOR EDITING =====
router.get('/today-categories', auth, async (req, res) => {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        
        // Get today's sessions
        const sessions = await DeepWorkSession.find({
            userId: req.session.userId,
            startTime: { $gte: today, $lt: tomorrow }
        });
        
        // Get user's task types for mapping
        const user = await User.findById(req.session.userId);
        const taskTypes = user.deepWorkStats?.customTaskTypes || [];
        
        // Create map for quick lookup
        const taskTypeMap = new Map();
        taskTypes.forEach(task => {
            taskTypeMap.set(task.id, {
                name: task.name,
                icon: task.icon || '⚙️',
                color: task.color || '#667eea'
            });
        });
        
        // Group sessions by task type
        const categoryMap = new Map();
        
        sessions.forEach(session => {
            const taskType = session.taskType || 'other';
            const minutes = session.durationMinutes || 0;
            
            const taskDetails = taskTypeMap.get(taskType) || {
                name: taskType.charAt(0).toUpperCase() + taskType.slice(1),
                icon: '⚙️',
                color: '#667eea'
            };
            
            if (!categoryMap.has(taskType)) {
                categoryMap.set(taskType, {
                    id: taskType,
                    name: taskDetails.name,
                    icon: taskDetails.icon,
                    color: taskDetails.color,
                    minutes: 0,
                    sessions: []
                });
            }
            
            const category = categoryMap.get(taskType);
            category.minutes += minutes;
            category.sessions.push({
                id: session._id,
                minutes: minutes,
                isManual: session.isManualEntry || false
            });
        });
        
        // Ensure all active task types are shown (even with 0 minutes)
        taskTypes.forEach(task => {
            if (task.isActive !== false) {
                if (!categoryMap.has(task.id)) {
                    categoryMap.set(task.id, {
                        id: task.id,
                        name: task.name,
                        icon: task.icon || '⚙️',
                        color: task.color || '#667eea',
                        minutes: 0,
                        sessions: []
                    });
                }
            }
        });
        
        const categories = Array.from(categoryMap.values())
            .sort((a, b) => b.minutes - a.minutes);
        
        const totalMinutes = categories.reduce((sum, cat) => sum + cat.minutes, 0);
        
        res.json({
            date: today,
            totalMinutes,
            categories
        });
        
    } catch (error) {
        console.error('Error getting today categories:', error);
        res.status(500).json({ error: error.message });
    }
});

// ===== UPDATE TODAY'S TIME BY CATEGORY =====
router.post('/update-category-time', auth, async (req, res) => {
    try {
        const { categoryId, minutes } = req.body;
        
        if (minutes < 0 || minutes > 1440) {
            return res.status(400).json({ error: 'Invalid minutes value' });
        }
        
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        
        // Get existing sessions for this category today
        const existingSessions = await DeepWorkSession.find({
            userId: req.session.userId,
            taskType: categoryId,
            startTime: { $gte: today, $lt: tomorrow }
        }).sort({ startTime: 1 });
        
        const currentTotal = existingSessions.reduce((sum, s) => sum + (s.durationMinutes || 0), 0);
        const difference = minutes - currentTotal;
        
        if (difference === 0) {
            return res.json({ success: true, message: 'No change needed' });
        }
        
        if (difference > 0) {
            // Need to ADD time - create a new manual session
            const user = await User.findById(req.session.userId);
            const taskTypes = user.deepWorkStats?.customTaskTypes || [];
            const taskType = taskTypes.find(t => t.id === categoryId);
            
            const manualSession = new DeepWorkSession({
                userId: req.session.userId,
                startTime: new Date(today.getTime() + 12 * 60 * 60 * 1000), // Noon
                endTime: new Date(today.getTime() + 12 * 60 * 60 * 1000 + difference * 60 * 1000),
                durationMinutes: difference,
                taskType: categoryId,
                taskDescription: `Manual: ${taskType?.name || categoryId}`,
                focusScore: 90,
                interruptions: 0,
                activeSession: false,
                isManualEntry: true
            });
            
            await manualSession.save();
            console.log(`✅ Added ${difference} minutes to ${categoryId}`);
            
        } else {
            // Need to REMOVE time
            const timeToRemove = Math.abs(difference);
            let remainingToRemove = timeToRemove;
            
            // First, try to remove from manual sessions
            const manualSessions = existingSessions.filter(s => s.isManualEntry);
            for (const session of manualSessions) {
                if (remainingToRemove <= 0) break;
                
                if (session.durationMinutes <= remainingToRemove) {
                    // Remove entire session
                    remainingToRemove -= session.durationMinutes;
                    await DeepWorkSession.findByIdAndDelete(session._id);
                    console.log(`✅ Deleted manual session with ${session.durationMinutes} minutes`);
                } else {
                    // Reduce this session
                    session.durationMinutes -= remainingToRemove;
                    session.endTime = new Date(session.startTime.getTime() + session.durationMinutes * 60 * 1000);
                    await session.save();
                    console.log(`✅ Reduced session by ${remainingToRemove} minutes`);
                    remainingToRemove = 0;
                }
            }
            
            // If still need to remove, reduce non-manual sessions
            if (remainingToRemove > 0) {
                const regularSessions = existingSessions.filter(s => !s.isManualEntry);
                for (const session of regularSessions) {
                    if (remainingToRemove <= 0) break;
                    
                    const canRemove = Math.min(session.durationMinutes, remainingToRemove);
                    session.durationMinutes -= canRemove;
                    
                    if (session.durationMinutes > 0) {
                        session.endTime = new Date(session.startTime.getTime() + session.durationMinutes * 60 * 1000);
                        await session.save();
                    } else {
                        // Remove session completely if duration becomes 0
                        await DeepWorkSession.findByIdAndDelete(session._id);
                    }
                    
                    remainingToRemove -= canRemove;
                }
            }
            
            console.log(`✅ Removed ${timeToRemove} minutes from ${categoryId} (${remainingToRemove} could not be removed)`);
        }
        
        // Update user's dailyStats
        await updateUserDailyStats(req.session.userId);
        
        res.json({ 
            success: true, 
            message: `Updated ${categoryId} to ${minutes} minutes`,
            newTotal: minutes
        });
        
    } catch (error) {
        console.error('Error updating category time:', error);
        res.status(500).json({ error: error.message });
    }
});

// Helper function to recalculate dailyStats
async function updateUserDailyStats(userId) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const sessions = await DeepWorkSession.find({
        userId: userId,
        startTime: { $gte: today, $lt: tomorrow }
    });
    
    const totalMinutes = sessions.reduce((sum, s) => sum + (s.durationMinutes || 0), 0);
    const avgFocus = sessions.length > 0 
        ? Math.round(sessions.reduce((sum, s) => sum + (s.focusScore || 0), 0) / sessions.length)
        : 0;
    
    const user = await User.findById(userId);
    
    if (!user.deepWorkStats) user.deepWorkStats = { dailyStats: [] };
    if (!user.deepWorkStats.dailyStats) user.deepWorkStats.dailyStats = [];
    
    // Find today's stats
    let todayStats = null;
    for (let i = 0; i < user.deepWorkStats.dailyStats.length; i++) {
        const stat = user.deepWorkStats.dailyStats[i];
        const statDate = new Date(stat.date);
        statDate.setHours(0, 0, 0, 0);
        
        if (statDate.getTime() === today.getTime()) {
            todayStats = stat;
            todayStats.totalMinutes = totalMinutes;
            todayStats.sessions = sessions.length;
            todayStats.avgFocusScore = avgFocus;
            todayStats.lastEdited = new Date();
            break;
        }
    }
    
    if (!todayStats) {
        user.deepWorkStats.dailyStats.push({
            date: today,
            totalMinutes: totalMinutes,
            sessions: sessions.length,
            avgFocusScore: avgFocus
        });
    }
    
    await user.save();
}
// ===== GOAL MANAGEMENT ENDPOINTS =====

// Get user's current goal
router.get('/get-goal', auth, async (req, res) => {
    try {
        const weekOffset = parseInt(req.query.weekOffset) || 0;
        const weekStartKey = normalizeWeekStartKey(req.query.weekStart) || getWeekDateKeysForOffset(weekOffset).mondayDateKey;
        const user = await User.findById(req.session.userId);
        const weeklyGoal = getGoalForWeek(user, weekStartKey);
        
        res.json({
            weekStart: weekStartKey,
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
        const weekOffset = parseInt(req.query.weekOffset) || 0;
        const today = new Date();
        const targetDate = new Date(today);
        targetDate.setDate(today.getDate() + (weekOffset * 7));
        // Calculate Monday of current week
        const monday = new Date(targetDate);
        const dayOfWeek = targetDate.getDay();
        const daysToSubtract = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
        monday.setDate(targetDate.getDate() - daysToSubtract);
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
        const weekOffset = parseInt(req.body.weekOffset) || 0;
        const weekStartKey = normalizeWeekStartKey(req.body.weekStart) || getWeekDateKeysForOffset(weekOffset).mondayDateKey;
        const monday = appDateKeyToUtcStart(weekStartKey);
        
        // Validate (between 1 and 100 hours)
        if (weeklyGoalMinutes < 60 || weeklyGoalMinutes > 6000) {
            return res.status(400).json({ error: 'Goal must be between 1 and 100 hours' });
        }
        
        const user = await User.findById(req.session.userId);
        
        if (!user.deepWorkStats) {
            user.deepWorkStats = {};
        }

        if (!Array.isArray(user.deepWorkStats.weeklyGoals)) {
            user.deepWorkStats.weeklyGoals = [];
        }
        
        const existingGoal = user.deepWorkStats.weeklyGoals.find(goal => {
            return normalizeWeekStartKey(goal.weekStart) === weekStartKey;
        });

        if (existingGoal) {
            existingGoal.goalMinutes = weeklyGoalMinutes;
        } else {
            user.deepWorkStats.weeklyGoals.push({
                weekStart: monday,
                goalMinutes: weeklyGoalMinutes
            });
        }

        if (weekOffset === 0) {
            user.deepWorkStats.weeklyGoal = weeklyGoalMinutes;
            user.deepWorkStats.goalWeekStart = monday;
        }

        await user.save();
        
        res.json({ 
            success: true, 
            weekStart: weekStartKey,
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
