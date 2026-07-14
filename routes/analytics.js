const express = require('express');
const router = express.Router();
const User = require('../models/User');
const DeepWorkSession = require('../models/DeepWorkSession');
const WeeklyReview = require('../models/WeeklyReview');
const ScheduledDeepWorkBlock = require('../models/ScheduledDeepWorkBlock');
const TopicPlanItem = require('../models/TopicPlanItem');

const APP_TIME_ZONE_OFFSET_MINUTES = 330;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_EARLY_MORNING_CUTOFF_MINUTES = 360; // 6:00 AM

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

router.get('/weekly-review', auth, async (req, res) => {
    try {
        const weekOffset = req.query.weekOffset !== undefined && Number.isFinite(Number(req.query.weekOffset))
            ? Number(req.query.weekOffset)
            : getDefaultReviewWeekOffset();
        const week = getWeekRangeForOffset(weekOffset);
        const user = await User.findById(req.session.userId);
        const questions = getUserReviewQuestions(user);
        const review = await WeeklyReview.findOne({
            userId: req.session.userId,
            weekStart: week.weekStart
        }).lean();

        const analysis = await buildWeeklyAnalysis(req.session.userId, week);
        res.json({
            ...analysis,
            questions,
            review: normalizeReview(review, week, questions)
        });
    } catch (error) {
        console.error('Error fetching weekly review:', error);
        res.status(500).json({ error: error.message });
    }
});

router.post('/set-early-morning-cutoff', auth, async (req, res) => {
    try {
        const { cutoffTime } = req.body;
        if (!cutoffTime || !/^\d{2}:\d{2}$/.test(cutoffTime)) {
            return res.status(400).json({ error: 'Valid cutoffTime (HH:MM) is required' });
        }

        const [hoursStr, minutesStr] = cutoffTime.split(':');
        const cutoffMinutes = Number(hoursStr) * 60 + Number(minutesStr);
        if (!Number.isFinite(cutoffMinutes) || cutoffMinutes < 0 || cutoffMinutes > 1439) {
            return res.status(400).json({ error: 'Invalid cutoff time' });
        }

        const weekOffset = parseInt(req.body.weekOffset, 10) || 0;
        const weekStartKey = normalizeWeekStartInput(req.body.weekStart) || getWeekRangeForOffset(weekOffset).weekStart;
        const monday = appDateKeyToUtcStart(weekStartKey);

        const user = await User.findById(req.session.userId);
        if (!user.deepWorkStats) user.deepWorkStats = {};
        if (!Array.isArray(user.deepWorkStats.earlyMorningCutoffs)) {
            user.deepWorkStats.earlyMorningCutoffs = [];
        }

        const existingCutoff = user.deepWorkStats.earlyMorningCutoffs.find(entry => {
            return normalizeWeekStartKey(entry.weekStart) === weekStartKey;
        });

        if (existingCutoff) {
            existingCutoff.cutoffMinutes = cutoffMinutes;
        } else {
            user.deepWorkStats.earlyMorningCutoffs.push({
                weekStart: monday,
                cutoffMinutes
            });
        }

        if (weekOffset === 0) {
            user.deepWorkStats.earlyMorningCutoffMinutes = cutoffMinutes;
            user.deepWorkStats.earlyMorningCutoffWeekStart = monday;
        }

        await user.save();

        res.json({
            success: true,
            weekStart: weekStartKey,
            cutoffMinutes,
            cutoffTime,
            cutoffLabel: formatMinutesAsClockLabel(cutoffMinutes)
        });
    } catch (error) {
        console.error('Error saving early morning cutoff:', error);
        res.status(500).json({ error: error.message });
    }
});

router.post('/weekly-review', auth, async (req, res) => {
    try {
        const { weekStart, answers = {}, isCompleted = true } = req.body;
        if (!weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
            return res.status(400).json({ error: 'Valid weekStart is required' });
        }

        const week = getWeekRangeFromStart(weekStart);
        const user = await User.findById(req.session.userId);
        const questions = getUserReviewQuestions(user);
        const goalMinutes = user?.deepWorkStats?.weeklyGoal || 1500;
        const cleanAnswers = questions.reduce((memo, question) => {
            memo[question.id] = String(answers[question.id] || '').trim();
            return memo;
        }, {});

        const review = await WeeklyReview.findOneAndUpdate(
            { userId: req.session.userId, weekStart: week.weekStart },
            {
                userId: req.session.userId,
                weekStart: week.weekStart,
                weekEnd: week.weekEnd,
                appliesToWeekStart: week.appliesToWeekStart,
                goalMinutes,
                answers: cleanAnswers,
                isCompleted: Boolean(isCompleted),
                updatedAt: new Date()
            },
            { new: true, upsert: true, setDefaultsOnInsert: true }
        ).lean();

        res.json({ success: true, review: normalizeReview(review, week, questions) });
    } catch (error) {
        console.error('Error saving weekly review:', error);
        res.status(500).json({ error: error.message });
    }
});

router.get('/weekly-review/constraint', auth, async (req, res) => {
    try {
        const currentWeek = getWeekRangeForOffset(0);
        const user = await User.findById(req.session.userId);
        const questions = getUserReviewQuestions(user);
        const constraintQuestion = questions.find(question => question.isConstraint);

        if (!constraintQuestion) {
            return res.json({ hasConstraint: false, constraint: '', sourceWeekStart: null, sourceWeekEnd: null });
        }

        const review = await WeeklyReview.findOne({
            userId: req.session.userId,
            appliesToWeekStart: currentWeek.weekStart,
            isCompleted: true,
            [`answers.${constraintQuestion.id}`]: { $ne: '' }
        }).sort({ updatedAt: -1 }).lean();

        res.json({
            hasConstraint: Boolean(review?.answers?.[constraintQuestion.id]),
            constraint: review?.answers?.[constraintQuestion.id] || '',
            sourceWeekStart: review?.weekStart || null,
            sourceWeekEnd: review?.weekEnd || null
        });
    } catch (error) {
        console.error('Error fetching weekly constraint:', error);
        res.status(500).json({ error: error.message });
    }
});

// ===== WEEKLY REVIEW QUESTION MANAGEMENT ENDPOINTS =====

router.get('/review-questions', auth, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        res.json({ questions: getUserReviewQuestions(user) });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/review-questions/add', auth, async (req, res) => {
    try {
        const { label } = req.body;
        if (!label || label.trim() === '') {
            return res.status(400).json({ error: 'Question label is required' });
        }

        const user = await User.findById(req.session.userId);
        if (!user.deepWorkStats) user.deepWorkStats = {};
        if (!user.deepWorkStats.customReviewQuestions) user.deepWorkStats.customReviewQuestions = [];

        const newId = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') + '-' + Date.now();
        const maxOrder = user.deepWorkStats.customReviewQuestions.reduce(
            (max, q) => Math.max(max, q.order || 0), 0
        );

        const newQuestion = {
            id: newId,
            label: label.trim(),
            order: maxOrder + 1,
            isActive: true,
            isConstraint: false
        };

        user.deepWorkStats.customReviewQuestions.push(newQuestion);
        await user.save();

        res.json({ success: true, question: newQuestion });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.put('/review-questions/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const { label, isActive } = req.body;

        const user = await User.findById(req.session.userId);
        const question = user.deepWorkStats?.customReviewQuestions?.find(q => q.id === id);

        if (!question) {
            return res.status(404).json({ error: 'Question not found' });
        }

        if (label !== undefined && label.trim() !== '') question.label = label.trim();
        if (isActive !== undefined) question.isActive = isActive;

        await user.save();
        res.json({ success: true, question });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.delete('/review-questions/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const user = await User.findById(req.session.userId);
        const questions = user.deepWorkStats?.customReviewQuestions || [];
        const index = questions.findIndex(q => q.id === id);

        if (index === -1) {
            return res.status(404).json({ error: 'Question not found' });
        }

        questions.splice(index, 1);
        await user.save();

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/review-questions/reorder', auth, async (req, res) => {
    try {
        const { orderedIds } = req.body;
        const user = await User.findById(req.session.userId);
        const questions = user.deepWorkStats?.customReviewQuestions || [];

        const questionMap = {};
        questions.forEach(q => { questionMap[q.id] = q; });

        const reordered = orderedIds
            .filter(id => questionMap[id])
            .map((id, index) => ({ ...questionMap[id], order: index + 1 }));

        user.deepWorkStats.customReviewQuestions = reordered;
        await user.save();

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/weekly-review/schedule', auth, async (req, res) => {
    try {
        const targetWeekStart = normalizeWeekStartInput(req.query.targetWeekStart);
        if (!targetWeekStart) {
            return res.status(400).json({ error: 'Valid targetWeekStart is required' });
        }

        const blocks = await ScheduledDeepWorkBlock.find({
            userId: req.session.userId,
            targetWeekStart
        }).sort({ startMinute: 1 }).lean();

        res.json({ blocks });
    } catch (error) {
        console.error('Error fetching weekly schedule:', error);
        res.status(500).json({ error: error.message });
    }
});

router.post('/weekly-review/schedule', auth, async (req, res) => {
    try {
        const {
            sourceReviewWeekStart,
            targetWeekStart,
            taskTypeId,
            startMinute,
            endMinute,
            repeatDays
        } = req.body;

        const cleanTargetWeekStart = normalizeWeekStartInput(targetWeekStart);
        if (!cleanTargetWeekStart) {
            return res.status(400).json({ error: 'Valid targetWeekStart is required' });
        }

        const cleanStart = Number(startMinute);
        const cleanEnd = Number(endMinute);
        if (!Number.isInteger(cleanStart) || !Number.isInteger(cleanEnd) || cleanStart < 0 || cleanEnd > 1440 || cleanEnd <= cleanStart) {
            return res.status(400).json({ error: 'Start and end time must be a same-day block' });
        }

        const cleanRepeatDays = Array.isArray(repeatDays)
            ? [...new Set(repeatDays.map(Number).filter(day => Number.isInteger(day) && day >= 0 && day <= 6))]
            : [];
        if (cleanRepeatDays.length === 0) {
            return res.status(400).json({ error: 'Select at least one day' });
        }

        const user = await User.findById(req.session.userId);
        const taskType = user?.deepWorkStats?.customTaskTypes?.find(task => task.id === taskTypeId);
        if (!taskType) {
            return res.status(400).json({ error: 'Select a valid Deepwork task' });
        }

        const block = await ScheduledDeepWorkBlock.create({
            userId: req.session.userId,
            targetWeekStart: cleanTargetWeekStart,
            sourceReviewWeekStart: normalizeWeekStartInput(sourceReviewWeekStart),
            taskTypeId: taskType.id,
            taskName: taskType.name,
            taskIcon: taskType.icon || '',
            color: taskType.color || '#667eea',
            startMinute: cleanStart,
            endMinute: cleanEnd,
            repeatDays: cleanRepeatDays.sort((a, b) => a - b),
            updatedAt: new Date()
        });

        res.status(201).json({ success: true, block });
    } catch (error) {
        console.error('Error saving weekly schedule:', error);
        res.status(500).json({ error: error.message });
    }
});

router.put('/weekly-review/schedule/:id', auth, async (req, res) => {
    try {
        const { targetWeekStart, taskTypeId, startMinute, endMinute, repeatDays } = req.body;

        const cleanTargetWeekStart = normalizeWeekStartInput(targetWeekStart);
        if (!cleanTargetWeekStart) {
            return res.status(400).json({ error: 'Valid targetWeekStart is required' });
        }

        const cleanStart = Number(startMinute);
        const cleanEnd = Number(endMinute);
        if (!Number.isInteger(cleanStart) || !Number.isInteger(cleanEnd) || cleanStart < 0 || cleanEnd > 1440 || cleanEnd <= cleanStart) {
            return res.status(400).json({ error: 'Start and end time must be a same-day block' });
        }

        const cleanRepeatDays = Array.isArray(repeatDays)
            ? [...new Set(repeatDays.map(Number).filter(day => Number.isInteger(day) && day >= 0 && day <= 6))]
            : [];
        if (cleanRepeatDays.length === 0) {
            return res.status(400).json({ error: 'Select at least one day' });
        }

        const user = await User.findById(req.session.userId);
        const taskType = user?.deepWorkStats?.customTaskTypes?.find(task => task.id === taskTypeId);
        if (!taskType) {
            return res.status(400).json({ error: 'Select a valid Deepwork task' });
        }

        const block = await ScheduledDeepWorkBlock.findOneAndUpdate(
            { _id: req.params.id, userId: req.session.userId },
            {
                targetWeekStart: cleanTargetWeekStart,
                taskTypeId: taskType.id,
                taskName: taskType.name,
                taskIcon: taskType.icon || '',
                color: taskType.color || '#667eea',
                startMinute: cleanStart,
                endMinute: cleanEnd,
                repeatDays: cleanRepeatDays.sort((a, b) => a - b),
                updatedAt: new Date()
            },
            { new: true }
        );

        if (!block) {
            return res.status(404).json({ error: 'Scheduled block not found' });
        }

        res.json({ success: true, block });
    } catch (error) {
        console.error('Error updating weekly schedule:', error);
        res.status(500).json({ error: error.message });
    }
});

router.delete('/weekly-review/schedule/:id', auth, async (req, res) => {
    try {
        const block = await ScheduledDeepWorkBlock.findOneAndDelete({
            _id: req.params.id,
            userId: req.session.userId
        });

        if (!block) {
            return res.status(404).json({ error: 'Scheduled block not found' });
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting weekly schedule:', error);
        res.status(500).json({ error: error.message });
    }
});

// ===== TOPIC PLAN FOR NEXT WEEK ENDPOINTS =====

function normalizeTopicPlanDay(day) {
    if (day === null || day === undefined || day === '') return null;
    const numericDay = Number(day);
    return Number.isInteger(numericDay) && numericDay >= 0 && numericDay <= 6 ? numericDay : null;
}

router.get('/weekly-review/topic-plan', auth, async (req, res) => {
    try {
        const targetWeekStart = normalizeWeekStartInput(req.query.targetWeekStart);
        if (!targetWeekStart) {
            return res.status(400).json({ error: 'Valid targetWeekStart is required' });
        }

        const items = await TopicPlanItem.find({
            userId: req.session.userId,
            targetWeekStart
        }).sort({ order: 1, createdAt: 1 }).lean();

        res.json({ items });
    } catch (error) {
        console.error('Error fetching topic plan:', error);
        res.status(500).json({ error: error.message });
    }
});

router.post('/weekly-review/topic-plan', auth, async (req, res) => {
    try {
        const { targetWeekStart, categoryId, text, day } = req.body;

        const cleanTargetWeekStart = normalizeWeekStartInput(targetWeekStart);
        if (!cleanTargetWeekStart) {
            return res.status(400).json({ error: 'Valid targetWeekStart is required' });
        }

        const cleanText = String(text || '').trim();
        if (!cleanText) {
            return res.status(400).json({ error: 'Topic text is required' });
        }

        const cleanDay = normalizeTopicPlanDay(day);

        const user = await User.findById(req.session.userId);
        const category = user?.deepWorkStats?.customTaskTypes?.find(task => task.id === categoryId);
        if (!category) {
            return res.status(400).json({ error: 'Select a valid category' });
        }

        const maxOrder = await TopicPlanItem.find({
            userId: req.session.userId,
            targetWeekStart: cleanTargetWeekStart,
            categoryId: category.id
        }).sort({ order: -1 }).limit(1).lean();

        const item = await TopicPlanItem.create({
            userId: req.session.userId,
            targetWeekStart: cleanTargetWeekStart,
            categoryId: category.id,
            categoryName: category.name,
            categoryColor: category.color || '#667eea',
            text: cleanText,
            day: cleanDay,
            order: (maxOrder[0]?.order || 0) + 1,
            updatedAt: new Date()
        });

        res.status(201).json({ success: true, item });
    } catch (error) {
        console.error('Error saving topic plan item:', error);
        res.status(500).json({ error: error.message });
    }
});

router.put('/weekly-review/topic-plan/:id', auth, async (req, res) => {
    try {
        const { text, day, completed } = req.body;
        const update = { updatedAt: new Date() };

        if (text !== undefined) {
            const cleanText = String(text || '').trim();
            if (!cleanText) {
                return res.status(400).json({ error: 'Topic text is required' });
            }
            update.text = cleanText;
        }

        if (day !== undefined) {
            update.day = normalizeTopicPlanDay(day);
        }

        if (completed !== undefined) {
            update.completed = Boolean(completed);
            update.completedAt = update.completed ? new Date() : null;
        }

        const item = await TopicPlanItem.findOneAndUpdate(
            { _id: req.params.id, userId: req.session.userId },
            update,
            { new: true }
        );

        if (!item) {
            return res.status(404).json({ error: 'Topic not found' });
        }

        res.json({ success: true, item });
    } catch (error) {
        console.error('Error updating topic plan item:', error);
        res.status(500).json({ error: error.message });
    }
});

router.delete('/weekly-review/topic-plan/:id', auth, async (req, res) => {
    try {
        const item = await TopicPlanItem.findOneAndDelete({
            _id: req.params.id,
            userId: req.session.userId
        });

        if (!item) {
            return res.status(404).json({ error: 'Topic not found' });
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting topic plan item:', error);
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

async function buildWeeklyAnalysis(userId, week) {
    const user = await User.findById(userId);
    const review = await WeeklyReview.findOne({
        userId,
        weekStart: week.weekStart
    }).lean();
    const goalMinutes = review?.goalMinutes || user?.deepWorkStats?.weeklyGoal || 1500;
    const cutoffMinutes = getCutoffForWeek(user, week.weekStart);
    const sessions = await DeepWorkSession.find({
        userId,
        startTime: { $gte: week.utcStart, $lte: week.utcEnd },
        durationMinutes: { $gt: 0 }
    }).sort({ startTime: 1 }).lean();

    const customTaskTypes = user?.deepWorkStats?.customTaskTypes || [];
    const taskTypeNames = new Map(customTaskTypes.map(task => [task.id, task.name]));
    const days = buildWeekDays(week.weekStart);
    const dayMap = new Map(days.map(day => [day.date, { ...day, minutes: 0, sessions: 0, firstSessionTime: null }]));
    const depthBuckets = {
        under20: { label: 'under 20 min', note: 'not deep work', count: 0, minutes: 0 },
        between20And44: { label: '20-44 min', note: 'borderline', count: 0, minutes: 0 },
        between45And89: { label: '45-89 min', note: 'solid', count: 0, minutes: 0 },
        over90: { label: '90+ min', note: 'deep work', count: 0, minutes: 0 }
    };
    const categoryTotals = new Map([
        ['ML / DS', 0],
        ['SQL', 0],
        ['DSA', 0],
        ['Other', 0]
    ]);

    sessions.forEach(session => {
        const minutes = session.durationMinutes || 0;
        const dateKey = toAppDateKey(new Date(session.startTime));
        const day = dayMap.get(dateKey);

        if (day) {
            day.minutes += minutes;
            day.sessions += 1;
            if (!day.firstSessionTime || new Date(session.startTime) < new Date(day.firstSessionTime)) {
                day.firstSessionTime = session.startTime;
            }
        }

        const depthKey = getDepthBucketKey(minutes);
        depthBuckets[depthKey].count += 1;
        depthBuckets[depthKey].minutes += minutes;

        const category = getReviewCategory(session, taskTypeNames);
        categoryTotals.set(category, (categoryTotals.get(category) || 0) + minutes);
    });

    const daily = Array.from(dayMap.values());
    const totalMinutes = sessions.reduce((sum, session) => sum + (session.durationMinutes || 0), 0);
    const activeDays = daily.filter(day => day.minutes > 0).length;
    const realDeepWorkMinutes = sessions
        .filter(session => (session.durationMinutes || 0) >= 45)
        .reduce((sum, session) => sum + (session.durationMinutes || 0), 0);
    const shallowSessions = sessions.filter(session => (session.durationMinutes || 0) < 30).length;
    const bestDay = daily.reduce((best, day) => day.minutes > best.minutes ? day : best, daily[0]);
    const earlyStarts = daily.filter(day => {
        if (!day.firstSessionTime) return false;
        return getAppMinutesFromDate(new Date(day.firstSessionTime)) < cutoffMinutes;
    }).length;

    const previousWeekRange = getWeekRangeFromStart(addDaysToDateKey(week.weekStart, -7));
    const previousWeekCutoffMinutes = getCutoffForWeek(user, previousWeekRange.weekStart);
    const previousWeekEarlyStarts = await computeEarlyStartCount(userId, previousWeekRange, previousWeekCutoffMinutes);

    const categories = Array.from(categoryTotals.entries())
        .filter(([, minutes]) => minutes > 0)
        .map(([name, minutes]) => ({
            name,
            minutes,
            percent: totalMinutes > 0 ? Math.round((minutes / totalMinutes) * 100) : 0,
            target: getCategoryTarget(name)
        }));

    return {
        weekStart: week.weekStart,
        weekEnd: week.weekEnd,
        weekRangeLabel: formatWeekRange(week.weekStart, week.weekEnd),
        goalMinutes,
        summary: {
            totalMinutes,
            totalSessions: sessions.length,
            activeDays,
            aboveGoalMinutes: totalMinutes - goalMinutes,
            realDeepWorkMinutes,
            realDeepWorkLabel: 'sessions 45m+',
            shallowSessions,
            shallowPercent: sessions.length > 0 ? Math.round((shallowSessions / sessions.length) * 100) : 0,
            bestDay: bestDay ? {
                date: bestDay.date,
                label: `${bestDay.day} ${Number(bestDay.date.slice(-2))}`,
                minutes: bestDay.minutes,
                sessions: bestDay.sessions
            } : null
        },
        depth: Object.values(depthBuckets),
        daily,
        categories,
        earlyStarts: {
            count: earlyStarts,
            totalDays: 7,
            cutoffMinutes,
            cutoffTime: minutesToClockInput(cutoffMinutes),
            cutoffLabel: formatMinutesAsClockLabel(cutoffMinutes),
            previousWeekCount: previousWeekEarlyStarts,
            diffFromLastWeek: earlyStarts - previousWeekEarlyStarts,
            days: daily.map(day => ({
                day: day.day.charAt(0),
                date: day.date,
                time: day.firstSessionTime ? formatAppTime(new Date(day.firstSessionTime)) : null,
                isEarly: day.firstSessionTime ? getAppMinutesFromDate(new Date(day.firstSessionTime)) < cutoffMinutes : false
            }))
        }
    };
}

function getUserReviewQuestions(user) {
    const questions = user?.deepWorkStats?.customReviewQuestions || [];
    return questions
        .map(q => ({
            id: q.id,
            label: q.label,
            order: q.order || 0,
            isActive: q.isActive !== false,
            isConstraint: Boolean(q.isConstraint)
        }))
        .sort((a, b) => a.order - b.order);
}

function normalizeReview(review, week, questions) {
    return {
        weekStart: week.weekStart,
        weekEnd: week.weekEnd,
        appliesToWeekStart: week.appliesToWeekStart,
        goalMinutes: review?.goalMinutes || null,
        isCompleted: Boolean(review?.isCompleted),
        answers: questions.reduce((memo, question) => {
            memo[question.id] = review?.answers?.[question.id] || '';
            return memo;
        }, {}),
        updatedAt: review?.updatedAt || null
    };
}

function getWeekRangeForOffset(weekOffset) {
    const todayKey = toAppDateKey(new Date());
    const targetKey = addDaysToDateKey(todayKey, weekOffset * 7);
    const dayOfWeek = getAppDayOfWeek(targetKey);
    const daysToSubtract = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    return getWeekRangeFromStart(addDaysToDateKey(targetKey, -daysToSubtract));
}

function normalizeWeekStartInput(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function normalizeWeekStartKey(value) {
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    if (value) {
        const parsed = new Date(value);
        if (!Number.isNaN(parsed.getTime())) return toAppDateKey(parsed);
    }
    return null;
}

function getCutoffForWeek(user, weekStartKey) {
    const savedCutoff = user?.deepWorkStats?.earlyMorningCutoffs?.find(entry => {
        return normalizeWeekStartKey(entry.weekStart) === weekStartKey;
    });

    if (savedCutoff && Number.isFinite(savedCutoff.cutoffMinutes)) {
        return savedCutoff.cutoffMinutes;
    }

    if (user?.deepWorkStats?.earlyMorningCutoffWeekStart && Number.isFinite(user?.deepWorkStats?.earlyMorningCutoffMinutes)) {
        if (normalizeWeekStartKey(user.deepWorkStats.earlyMorningCutoffWeekStart) === weekStartKey) {
            return user.deepWorkStats.earlyMorningCutoffMinutes;
        }
    }

    return DEFAULT_EARLY_MORNING_CUTOFF_MINUTES;
}

async function computeEarlyStartCount(userId, weekRange, cutoffMinutes) {
    const sessions = await DeepWorkSession.find({
        userId,
        startTime: { $gte: weekRange.utcStart, $lte: weekRange.utcEnd },
        durationMinutes: { $gt: 0 }
    }).sort({ startTime: 1 }).lean();

    const firstSessionByDay = new Map();
    sessions.forEach(session => {
        const dateKey = toAppDateKey(new Date(session.startTime));
        const existing = firstSessionByDay.get(dateKey);
        if (!existing || new Date(session.startTime) < new Date(existing)) {
            firstSessionByDay.set(dateKey, session.startTime);
        }
    });

    let count = 0;
    firstSessionByDay.forEach(time => {
        if (getAppMinutesFromDate(new Date(time)) < cutoffMinutes) count += 1;
    });
    return count;
}

function formatMinutesAsClockLabel(minutes) {
    const hours24 = Math.floor(minutes / 60) % 24;
    const mins = minutes % 60;
    const period = hours24 >= 12 ? 'PM' : 'AM';
    const hours12 = hours24 % 12 || 12;
    return mins === 0 ? `${hours12} ${period}` : `${hours12}:${String(mins).padStart(2, '0')} ${period}`;
}

function minutesToClockInput(minutes) {
    const hours24 = Math.floor(minutes / 60) % 24;
    const mins = minutes % 60;
    return `${String(hours24).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

function getDefaultReviewWeekOffset() {
    const now = new Date();
    const appNow = new Date(now.getTime() + APP_TIME_ZONE_OFFSET_MINUTES * 60000);
    const dayOfWeek = appNow.getUTCDay();
    const minutesSinceMidnight = appNow.getUTCHours() * 60 + appNow.getUTCMinutes();
    return dayOfWeek === 0 && minutesSinceMidnight >= 18 * 60 ? 0 : -1;
}

function getWeekRangeFromStart(weekStart) {
    const weekEnd = addDaysToDateKey(weekStart, 6);
    return {
        weekStart,
        weekEnd,
        appliesToWeekStart: addDaysToDateKey(weekStart, 7),
        utcStart: appDateKeyToUtcStart(weekStart),
        utcEnd: new Date(appDateKeyToUtcStart(addDaysToDateKey(weekEnd, 1)).getTime() - 1)
    };
}

function buildWeekDays(weekStart) {
    const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    return names.map((day, index) => ({
        day,
        date: addDaysToDateKey(weekStart, index)
    }));
}

function getDepthBucketKey(minutes) {
    if (minutes < 20) return 'under20';
    if (minutes < 45) return 'between20And44';
    if (minutes < 90) return 'between45And89';
    return 'over90';
}

function getReviewCategory(session, taskTypeNames) {
    const text = [
        session.taskType,
        session.taskDescription,
        taskTypeNames.get(session.taskType)
    ].filter(Boolean).join(' ').toLowerCase();

    if (/\bsql\b|leetcode/.test(text)) return 'SQL';
    if (/\bdsa\b|striver|array|tree|graph|stack|queue|linked/.test(text)) return 'DSA';
    if (/\bml\b|machine|forest|bagging|boosting|model|project|ds\b|data science/.test(text)) return 'ML / DS';
    return 'Other';
}

function getCategoryTarget(name) {
    if (name === 'ML / DS') return 50;
    if (name === 'SQL') return 30;
    if (name === 'DSA') return 20;
    return null;
}

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

function getAppMinutesFromDate(date) {
    const appDate = new Date(date.getTime() + APP_TIME_ZONE_OFFSET_MINUTES * 60000);
    return appDate.getUTCHours() * 60 + appDate.getUTCMinutes();
}

function formatAppTime(date) {
    const appDate = new Date(date.getTime() + APP_TIME_ZONE_OFFSET_MINUTES * 60000);
    let hours = appDate.getUTCHours();
    const minutes = appDate.getUTCMinutes();
    const period = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    return minutes === 0 ? `${hours} ${period}` : `${hours}:${String(minutes).padStart(2, '0')} ${period}`;
}

function formatWeekRange(weekStart, weekEnd) {
    const start = appDateKeyToUtcStart(weekStart);
    const end = appDateKeyToUtcStart(weekEnd);
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const startLocal = new Date(start.getTime() + APP_TIME_ZONE_OFFSET_MINUTES * 60000);
    const endLocal = new Date(end.getTime() + APP_TIME_ZONE_OFFSET_MINUTES * 60000);
    return `${startLocal.getUTCDate()}-${endLocal.getUTCDate()} ${monthNames[endLocal.getUTCMonth()]}`;
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
