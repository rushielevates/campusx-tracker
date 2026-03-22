// Global variables
let currentSessionId = null;
let timerInterval = null;
let seconds = 0;
let taskType = 'other';
let taskDescription = '';
// Week navigation variables
let currentWeekOffset = 0; // 0 = current week, -1 = last week, -2 = two weeks ago, etc.
let isLoadingWeekly = false;

// Load data on page load
// Load data on page load (KEEP THIS ONE)
// Load data on page load - PARALLEL VERSION
window.onload = async function() {
    console.log('🔵 Deep Work page loaded - START');
    
    // Load user info first (needed for everything)
    await loadUserInfo();
    console.log('✅ loadUserInfo complete');
    
    // Load task types (needed for dropdown)
    await loadTaskTypes();
    console.log('✅ loadTaskTypes complete');
    
    // Now load EVERYTHING ELSE IN PARALLEL!
    console.log('🔵 Loading all dashboard data in parallel...');
    
    await Promise.all([
        checkActiveSession(),      // Restores timer if needed
        loadWeeklyStats(),          // Bar chart
        loadWeeklyReport(),         // Weekly progress card
        loadTodayProgress(),        // Today's compact stats
        loadUserGoal(),             // Goal slider
        loadCategoryBreakdown(),     // Category breakdown
         loadTasks(),                // ← ADD THIS INSIDE
        loadNotes()                 // ← ADD THIS INSIDE
    ]);
    switchTab('tasks');
    console.log('✅ All dashboard data loaded in parallel!');
    console.log('🔵 Deep Work page loaded - END');
};
// Check if there's an active session
async function checkActiveSession() {
    try {
         // First check localStorage for quick UI restoration
        const localActive = localStorage.getItem('deepWorkActive');
        const localSessionId = localStorage.getItem('deepWorkSessionId');
        const localStartTime = localStorage.getItem('deepWorkStartTime');
        
        if (localActive === 'true' && localSessionId && localStartTime) {
            const elapsedSeconds = Math.floor((Date.now() - parseInt(localStartTime)) / 1000);
            // Show restoring UI immediately
            showRestoringUI(localSessionId, elapsedSeconds);
        }
        const response = await fetch('/api/deepwork/current-session', {
            credentials: 'include'
        });
        
        if (response.ok) {
            const data = await response.json();
            if (data.hasActiveSession) {
                console.log('Found active session:', data);
                // Restore the timer
                currentSessionId = data.sessionId;
                seconds = data.elapsedSeconds;
                taskType = data.taskType;
                taskDescription = data.taskDescription;

                
                // Update localStorage with server data
                localStorage.setItem('deepWorkActive', 'true');
                localStorage.setItem('deepWorkSessionId', data.sessionId);
                localStorage.setItem('deepWorkStartTime', Date.now() - (data.elapsedSeconds * 1000));
                
                updateTimerDisplay();
                startTimerFromExisting(data.elapsedSeconds);
            } else{
                // Clear localStorage if server says no active session
                localStorage.removeItem('deepWorkActive');
                localStorage.removeItem('deepWorkSessionId');
                localStorage.removeItem('deepWorkStartTime');
            }
        }
    } catch (error) {
        console.error('Error checking active session:', error);
    }
}
// ===== CATEGORY BREAKDOWN FUNCTIONS =====
async function loadCategoryBreakdown() {
    console.log('🔵 loadCategoryBreakdown STARTED at', Date.now());
    console.log('🔵 Current URL:', window.location.href);
    console.log('🔵 Document readyState:', document.readyState);
    console.log('🔵 loadCategoryBreakdown STARTED');
    try {
        console.log('Loading category breakdown...');
        const response = await fetch('/api/deepwork/category-breakdown', {
            credentials: 'include'
        });
        
        console.log('🔵 Response status:', response.status);
        
        if (!response.ok) {
            throw new Error('Failed to load categories');
        }
        
        const data = await response.json();
        console.log('🔵 Category data received:', data);
        
        const categoryList = document.getElementById('categoryList');
        const categoryTotal = document.getElementById('categoryTotal');
        
        console.log('🔵 categoryList element:', categoryList);
        console.log('🔵 categoryTotal element:', categoryTotal);
        
        if (!categoryList || !categoryTotal) {
            console.error('❌ Category elements not found');
            return;
        }
        
        if (!data.categories || data.categories.length === 0) {
            console.log('🔵 No categories data, showing empty state');
            categoryList.innerHTML = '<div class="loading-categories">No sessions this week</div>';
            categoryTotal.textContent = `Total: 0h`;
            return;
        }
        
        console.log('🔵 About to render', data.categories.length, 'categories');
        
        // Calculate total minutes for percentage if not provided
        const totalMinutes = data.totalMinutes || 
            data.categories.reduce((sum, cat) => sum + (cat.minutes || 0), 0);
        
        categoryList.innerHTML = data.categories.map(cat => {
            // Calculate percentage if not provided
            const percentage = cat.percentage || 
                (totalMinutes > 0 ? Math.round((cat.minutes / totalMinutes) * 100) : 0);
            
            return `
            <div class="category-item">
                <div class="category-icon">${cat.icon || '⚙️'}</div>
                <div class="category-info">
                    <div class="category-name">${cat.name || cat.id}</div>
                    <div class="category-bar-container">
                        <div class="category-bar-bg">
                            <div class="category-bar-fill" style="width: ${percentage}%"></div>
                        </div>
                        <span class="category-hours">${cat.hours || (cat.minutes/60).toFixed(1)}h</span>
                        <span class="category-percent">${percentage}%</span>
                    </div>
                </div>
            </div>
        `}).join('');
        
        categoryTotal.textContent = `Total: ${data.totalHours || (totalMinutes/60).toFixed(1)}h`;
        console.log('🔵 Category list updated, HTML length:', categoryList.innerHTML.length);
        
    } catch (error) {
        console.error('❌ Error loading category breakdown:', error);
        const categoryList = document.getElementById('categoryList');
        if (categoryList) {
            categoryList.innerHTML = '<div class="loading-categories">Error loading categories</div>';
        }
    }
    console.log('🔵 loadCategoryBreakdown FINISHED');
}
// ===== UPDATE Today's Progress for Compact View =====
// Modify your existing loadTodayProgress function to update compact stats

// Helper function for immediate UI feedback
function showRestoringUI(sessionId, elapsedSeconds) {
    console.log('Restoring session from localStorage...');
    document.getElementById('taskDescription').value = 'Restoring...';
    document.getElementById('taskDescription').disabled = true;
    document.getElementById('taskType').disabled = true;
    document.getElementById('startBtn').style.display = 'none';
    document.getElementById('pauseBtn').style.display = 'inline-block';
    document.getElementById('stopBtn').style.display = 'inline-block';
    document.querySelector('.task-input').style.opacity = '0.5';
    
    // Show approximate time while waiting for server
    seconds = elapsedSeconds;
    updateTimerDisplay();
}

// Start timer from existing session
function startTimerFromExisting(elapsedSeconds) {
    const sessionStartTime = Date.now() - (elapsedSeconds * 1000);
    
    if (timerInterval) {
        clearInterval(timerInterval);
    }
    
    timerInterval = setInterval(() => {
        const realSeconds = Math.floor((Date.now() - sessionStartTime) / 1000);
        if (realSeconds !== seconds) {
            seconds = realSeconds;
            updateTimerDisplay();
        }
    }, 200);
    
    startPingInterval();
    
    document.getElementById('startBtn').style.display = 'none';
    document.getElementById('pauseBtn').style.display = 'inline-block';
    document.getElementById('stopBtn').style.display = 'inline-block';
    document.querySelector('.task-input').style.opacity = '0.5';
    document.querySelector('.task-input input').disabled = true;
    document.querySelector('.task-input select').disabled = true;
}
// Load user info
async function loadUserInfo() {
    try {
        const response = await fetch('/api/auth/user', {
            credentials: 'include'
        });
        if (response.ok) {
            const user = await response.json();
            document.getElementById('username').textContent = user.username || 'CampusX Learner';
            document.getElementById('user-email').textContent = user.email || 'learner@campusx.com';
        } else {
            // Fallback to mock data
            document.getElementById('username').textContent = 'CampusX Learner';
            document.getElementById('user-email').textContent = 'learner@campusx.com';
        }
    } catch (error) {
        console.error('Error loading user info:', error);
        document.getElementById('username').textContent = 'CampusX Learner';
        document.getElementById('user-email').textContent = 'learner@campusx.com';
    }
}

// ===== TIMER FUNCTIONS =====
function startTimer() {
    taskDescription = document.getElementById('taskDescription').value;
    taskType = document.getElementById('taskType').value;
    
    if (!taskDescription) {
        alert('Please describe what you\'re working on');
        return;
    }
    
    console.log('Starting timer with:', { taskType, taskDescription });
    
    fetch('/api/deepwork/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ taskType, taskDescription })
    })
    .then(res => {
        if (!res.ok) {
            throw new Error('Failed to start session');
        }
        return res.json();
    })
    .then(data => {
        console.log('Session started:', data);
        currentSessionId = data.sessionId;
        
        // Store the actual start time
        const sessionStartTime = Date.now();
        seconds = 0;
        updateTimerDisplay();
        
        localStorage.setItem('deepWorkActive', 'true');
        localStorage.setItem('deepWorkSessionId', data.sessionId);
        localStorage.setItem('deepWorkStartTime', sessionStartTime.toString());
        
        // Clear any existing interval
        if (timerInterval) {
            clearInterval(timerInterval);
        }
        
        // Use accurate timer based on real time
        timerInterval = setInterval(() => {
            // Calculate real elapsed seconds
            const realSeconds = Math.floor((Date.now() - sessionStartTime) / 1000);
            
            // Update if changed
            if (realSeconds !== seconds) {
                seconds = realSeconds;
                updateTimerDisplay();
            }
        }, 200); // Check 5 times per second for accuracy
        
        startPingInterval();
        
        document.getElementById('startBtn').style.display = 'none';
        document.getElementById('pauseBtn').style.display = 'inline-block';
        document.getElementById('stopBtn').style.display = 'inline-block';
        document.querySelector('.task-input').style.opacity = '0.5';
        document.querySelector('.task-input input').disabled = true;
        document.querySelector('.task-input select').disabled = true;
    })
    .catch(error => {
        console.error('Error starting timer:', error);
        alert('Failed to start timer. Please try again.');
    });
}

// Add after starting timer
function startPingInterval() {
    if (window.pingInterval) {
        clearInterval(window.pingInterval);
    }
    window.pingInterval = setInterval(() => {
        if (currentSessionId) {
            fetch('/api/deepwork/ping', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId: currentSessionId })
            }).catch(err => console.log('Ping failed:', err));
        }
    }, 30000); // Ping every 30 seconds
}


function pauseTimer() {
    clearInterval(timerInterval);
    document.getElementById('pauseBtn').style.display = 'none';
    document.getElementById('startBtn').style.display = 'inline-block';
    document.getElementById('startBtn').textContent = 'Resume';
}

function stopTimer() {
        // Clear ping interval when stopping
    if (window.pingInterval) {
        clearInterval(window.pingInterval);
    }
    if (!currentSessionId) {
        resetTimer();
        return;
    }
    
    clearInterval(timerInterval);
    
    const focusScore = 100;
    const durationMinutes = Math.max(1, Math.floor(seconds / 60));
    
    console.log('Stopping timer:', { sessionId: currentSessionId, durationMinutes });
    
    fetch(`/api/deepwork/end/${currentSessionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ 
            duration: durationMinutes,
            focusScore,
            interruptions: 0
        })
    })
    .then(res => {
        if (!res.ok) {
            throw new Error('Failed to end session');
        }
        return res.json();
    })
    .then(data => {
        console.log('Session ended:', data);
        resetTimer();
    localStorage.removeItem('deepWorkActive');
    localStorage.removeItem('deepWorkSessionId');
    localStorage.removeItem('deepWorkStartTime');
        return Promise.all([
            loadWeeklyStats(),
            loadWeeklyReport()
        ]);
    })
    .catch(error => {
        console.error('Error stopping timer:', error);
        alert('Failed to save session. Please try again.');
        resetTimer();
    });
}

function resetTimer() {
        // Clear ping interval when stopping
    if (window.pingInterval) {
        clearInterval(window.pingInterval);
    }
    currentSessionId = null;
    seconds = 0;
    updateTimerDisplay();
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
    
    document.getElementById('startBtn').style.display = 'inline-block';
    document.getElementById('pauseBtn').style.display = 'none';
    document.getElementById('stopBtn').style.display = 'none';
    document.getElementById('startBtn').textContent = 'Start';
    document.querySelector('.task-input').style.opacity = '1';
    document.querySelector('.task-input input').disabled = false;
    document.querySelector('.task-input select').disabled = false;
    document.getElementById('taskDescription').value = '';
}

function updateTimerDisplay() {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    document.getElementById('timerDisplay').textContent = 
        `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// ===== WEEKLY BAR CHART =====
// ===== WEEKLY BAR CHART WITH NAVIGATION =====
async function loadWeeklyStats() {
    if (isLoadingWeekly) return;
    
    isLoadingWeekly = true;
    const chartContainer = document.getElementById('barChart');
    const prevBtn = document.getElementById('prevWeekBtn');
    const nextBtn = document.getElementById('nextWeekBtn');
    
    try {
        // Add loading class
        if (chartContainer) chartContainer.classList.add('loading');
        
        console.log(`Loading weekly stats for offset: ${currentWeekOffset}`);
        const response = await fetch(`/api/deepwork/weekly-stats?weekOffset=${currentWeekOffset}`, {
            credentials: 'include'
        });
        
        if (!response.ok) {
            throw new Error('Failed to load stats');
        }
        
        const data = await response.json();
        console.log('Weekly stats:', data);
        
        // Update week range display
        const weekRangeEl = document.getElementById('weekRangeDisplay');
        if (weekRangeEl) {
            weekRangeEl.textContent = data.weekRangeDisplay;
        }
        
        // Update navigation buttons state
        if (nextBtn) {
            nextBtn.disabled = data.isCurrentWeek;
        }
        if (prevBtn) {
            prevBtn.disabled = false;
        }
        
        // Render the chart
        renderBarChart(data.data);
        
    } catch (error) {
        console.error('Error loading weekly stats:', error);
        // Show error in chart area
        const chart = document.getElementById('barChart');
        if (chart) {
            chart.innerHTML = '<p style="text-align: center; color: #dc3545; padding: 40px;">Failed to load data. Please try again.</p>';
        }
    } finally {
        isLoadingWeekly = false;
        if (chartContainer) chartContainer.classList.remove('loading');
    }
}

// Load previous week
function loadPreviousWeek() {
    currentWeekOffset--;
    loadWeeklyStats();
}

// Load next week
function loadNextWeek() {
    if (currentWeekOffset < 0) {
        currentWeekOffset++;
        loadWeeklyStats();
    }
}

// Load current week (reset to today)
function loadCurrentWeek() {
    if (currentWeekOffset !== 0) {
        currentWeekOffset = 0;
        loadWeeklyStats();
    }
}

// Update renderBarChart to handle empty data
function renderBarChart(stats) {
    const chart = document.getElementById('barChart');
    chart.innerHTML = '';
    chart.classList.remove('loading');
    
    if (!stats || stats.length === 0) {
        chart.innerHTML = '<p style="text-align: center; color: #666; padding: 40px;">No data for this week. Start a timer to see your stats!</p>';
        return;
    }
    
    // Check if all days have zero minutes
    const hasAnyData = stats.some(day => day.minutes > 0);
    if (!hasAnyData) {
        chart.innerHTML = '<p style="text-align: center; color: #666; padding: 40px;">No activity recorded for this week.</p>';
        return;
    }
    
    const maxMinutes = Math.max(...stats.map(s => s.minutes), 1);
    
    stats.forEach(day => {
        const height = maxMinutes > 0 ? (day.minutes / maxMinutes) * 180 : 0;
        
        const barContainer = document.createElement('div');
        barContainer.className = 'bar-container';
        
        const bar = document.createElement('div');
        bar.className = 'bar';
        bar.style.height = height + 'px';
        bar.setAttribute('data-tooltip', `${day.hours}h (${day.sessions} sessions, ${day.focusScore}% focus)`);
        
        const label = document.createElement('div');
        label.className = 'bar-label';
        label.textContent = day.day;
        
        const value = document.createElement('div');
        value.className = 'bar-value';
        value.textContent = day.hours + 'h';
        
        barContainer.appendChild(bar);
        barContainer.appendChild(label);
        barContainer.appendChild(value);
        chart.appendChild(barContainer);
    });
}

function renderBarChart(stats) {
    const chart = document.getElementById('barChart');
    chart.innerHTML = '';
    
    if (!stats || stats.length === 0) {
        chart.innerHTML = '<p style="text-align: center; color: #666; padding: 40px;">No data yet. Start a timer to see your stats!</p>';
        return;
    }
    
    const maxMinutes = Math.max(...stats.map(s => s.minutes), 1);
    
    stats.forEach(day => {
        const height = maxMinutes > 0 ? (day.minutes / maxMinutes) * 180 : 0;
        
        const barContainer = document.createElement('div');
        barContainer.className = 'bar-container';
        
        const bar = document.createElement('div');
        bar.className = 'bar';
        bar.style.height = height + 'px';
        bar.setAttribute('data-tooltip', `${day.hours}h (${day.sessions} sessions, ${day.focusScore}% focus)`);
        
        const label = document.createElement('div');
        label.className = 'bar-label';
        label.textContent = day.day;
        
        const value = document.createElement('div');
        value.className = 'bar-value';
        value.textContent = day.hours + 'h';
        
        barContainer.appendChild(bar);
        barContainer.appendChild(label);
        barContainer.appendChild(value);
        chart.appendChild(barContainer);
    });
}

function showMockChart() {
    const chart = document.getElementById('barChart');
    chart.innerHTML = '';
    
    const mockDays = [
        { day: 'Mon', hours: '2.5', sessions: 2, focus: 95 },
        { day: 'Tue', hours: '3.0', sessions: 3, focus: 92 },
        { day: 'Wed', hours: '1.5', sessions: 1, focus: 88 },
        { day: 'Thu', hours: '4.0', sessions: 4, focus: 96 },
        { day: 'Fri', hours: '2.0', sessions: 2, focus: 90 },
        { day: 'Sat', hours: '5.0', sessions: 5, focus: 98 },
        { day: 'Sun', hours: '1.0', sessions: 1, focus: 85 }
    ];
    
    const maxHours = 5;
    
    mockDays.forEach(day => {
        const height = (parseFloat(day.hours) / maxHours) * 180;
        
        const barContainer = document.createElement('div');
        barContainer.className = 'bar-container';
        
        const bar = document.createElement('div');
        bar.className = 'bar';
        bar.style.height = height + 'px';
        bar.setAttribute('data-tooltip', `${day.hours}h (${day.sessions} sessions, ${day.focus}% focus)`);
        
        const label = document.createElement('div');
        label.className = 'bar-label';
        label.textContent = day.day;
        
        const value = document.createElement('div');
        value.className = 'bar-value';
        value.textContent = day.hours + 'h';
        
        barContainer.appendChild(bar);
        barContainer.appendChild(label);
        barContainer.appendChild(value);
        chart.appendChild(barContainer);
    });
}

// ===== WEEKLY REPORT =====
// ===== WEEKLY REPORT =====
async function loadWeeklyReport() {
    try {
        console.log('Loading weekly report...');
        const response = await fetch('/api/deepwork/weekly-report', {
            credentials: 'include'
        });
        
        if (!response.ok) {
            throw new Error('Failed to load report');
        }
        
        const report = await response.json();
        console.log('Weekly report:', report);
        
        // Update week range
        document.getElementById('weekRange').textContent = report.weekRangeDisplay || 'This Week';
        
        // Main progress
        document.getElementById('weeklyTotal').textContent = report.totalHours + 'h';
        document.getElementById('goalProgressFill').style.width = (report.goal.percentage || 0) + '%';
        document.getElementById('goalPercentage').textContent = (report.goal.percentage || 0) + '%';
        
        // Stats list (vertical)
       document.getElementById('avgSession').textContent = report.avgDailyDisplay || '0m';
        
        if (report.bestDay) {
            document.getElementById('bestDay').textContent = report.bestDay.formatted;
        } else {
            document.getElementById('bestDay').textContent = 'No data';
        }
        
        document.getElementById('weeklyStreak').textContent = (report.weeklyStreak || 0) + ' days';
        
    } catch (error) {
        console.error('Error loading weekly report:', error);
        // Fallback values
        document.getElementById('weekRange').textContent = 'This Week';
        document.getElementById('weeklyTotal').textContent = '0h';
        document.getElementById('goalProgressFill').style.width = '0%';
        document.getElementById('goalPercentage').textContent = '0%';
        document.getElementById('avgSession').textContent = '0m';
        document.getElementById('bestDay').textContent = 'No data';
        document.getElementById('weeklyStreak').textContent = '0 days';

    }
}

// ===== NEW: Load Today's Progress =====
// ===== UPDATE Today's Progress for Compact View =====
async function loadTodayProgress() {
    try {
        console.log('Loading today progress...');
        const response = await fetch('/api/deepwork/today-stats', {
            credentials: 'include'
        });
        
        if (!response.ok) {
            throw new Error('Failed to load today stats');
        }
        
        const data = await response.json();
        console.log('Today progress data:', data);
        
        // Format today's total
        const hours = Math.floor(data.totalMinutes / 60);
        const minutes = data.totalMinutes % 60;
        const todayTotalStr = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
        
        // Update ONLY the compact view elements (these exist in your HTML)
        const totalEl = document.getElementById('todayTotalCompact');
        const sessionsEl = document.getElementById('todaySessionsCompact');
        const streakEl = document.getElementById('currentStreakCompact');
        
        if (totalEl) {
            totalEl.textContent = todayTotalStr;
        } else {
            console.error('Element todayTotalCompact not found');
        }
        
        if (sessionsEl) {
            sessionsEl.textContent = data.sessions;
        } else {
            console.error('Element todaySessionsCompact not found');
        }
        
        if (streakEl) {
            streakEl.textContent = data.streak;
        } else {
            console.error('Element currentStreakCompact not found');
        }
        
    } catch (error) {
        console.error('Error loading today progress:', error);
        // Set fallback values
        const totalEl = document.getElementById('todayTotalCompact');
        const sessionsEl = document.getElementById('todaySessionsCompact');
        const streakEl = document.getElementById('currentStreakCompact');
        
        if (totalEl) totalEl.textContent = '0h 0m';
        if (sessionsEl) sessionsEl.textContent = '0';
        if (streakEl) streakEl.textContent = '0';
    }
}

// ===== UPDATE Weekly Report Display =====

// ===== GOAL FUNCTIONS =====
function showGoalModal() {
    document.getElementById('goalModal').style.display = 'block';
    document.getElementById('goalInput').value = '20';
}

function closeGoalModal() {
    document.getElementById('goalModal').style.display = 'none';
}

function setGoal() {
    const hours = parseInt(document.getElementById('goalInput').value);
    if (hours > 0 && hours <= 100) {
        document.getElementById('goalTarget').textContent = hours + 'h';
        console.log('Setting goal to:', hours);
        closeGoalModal();
    } else {
        alert('Please enter a valid goal (1-100 hours)');
    }
}
// ===== GOAL FUNCTIONS =====
async function loadUserGoal() {
    try {
        const response = await fetch('/api/deepwork/get-goal', {
            credentials: 'include'
        });
        
        if (response.ok) {
            const data = await response.json();
            const goalHours = Math.round(data.weeklyGoal / 60);
            
            document.getElementById('goalTarget').textContent = goalHours + 'h';
            document.getElementById('goalValue').textContent = goalHours + 'h';
            document.getElementById('goalSlider').value = goalHours;
        }
    } catch (error) {
        console.error('Error loading goal:', error);
    }
}

async function updateGoal(hours) {
    try {
        const weeklyGoalMinutes = hours * 60;
        
        const response = await fetch('/api/deepwork/set-goal', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ weeklyGoalMinutes })
        });
        
        if (response.ok) {
            const data = await response.json();
            document.getElementById('goalTarget').textContent = data.weeklyGoalHours + 'h';
            document.getElementById('goalValue').textContent = data.weeklyGoalHours + 'h';
            
            // Refresh weekly report to update percentage
            await loadWeeklyReport();
        }
    } catch (error) {
        console.error('Error updating goal:', error);
    }
}

// Add event listener for slider
document.getElementById('goalSlider').addEventListener('input', function(e) {
    const hours = e.target.value;
    document.getElementById('goalValue').textContent = hours + 'h';
});

document.getElementById('goalSlider').addEventListener('change', function(e) {
    const hours = e.target.value;
    updateGoal(hours);
});
// ===== TASK TYPE MANAGEMENT =====

// Load task types into dropdown
async function loadTaskTypes() {
    try {
        const response = await fetch('/api/deepwork/task-types', {
            credentials: 'include'
        });
        
        if (response.ok) {
            const data = await response.json();
            const taskTypes = data.taskTypes;
            
            // Sort by order
            taskTypes.sort((a, b) => (a.order || 0) - (b.order || 0));
            
            // Update dropdown
            const select = document.getElementById('taskType');
            select.innerHTML = taskTypes.map(task => 
                `<option value="${task.id}" style="color: ${task.color}">${task.icon} ${task.name}</option>`
            ).join('');
            
            // Store for later use
            window.taskTypes = taskTypes;
        }
    } catch (error) {
        console.error('Error loading task types:', error);
    }
}

// Show task manager modal
function showTaskManager() {
    loadTaskList();
    document.getElementById('taskManagerModal').style.display = 'block';
}

function closeTaskManager() {
    document.getElementById('taskManagerModal').style.display = 'none';
}

// Load task list in manager
// Load task list in manager
// Load task list in manager (Simplified)
async function loadTaskList() {
    try {
        const response = await fetch('/api/deepwork/task-types', {
            credentials: 'include'
        });
        
        if (response.ok) {
            const data = await response.json();
            const taskTypes = data.taskTypes;
            
            taskTypes.sort((a, b) => (a.order || 0) - (b.order || 0));
            
            const taskList = document.getElementById('taskList');
            taskList.innerHTML = taskTypes.map(task => {
                return `
                <div class="task-item" data-id="${task.id}">
                    <div class="task-drag">⋮⋮</div>
                    <div class="task-icon">${task.icon}</div>
                    <input type="text" class="task-name" value="${task.name}" 
                           onchange="updateTask('${task.id}', this.value)">
                    <button class="delete-task-btn" onclick="deleteTask('${task.id}')">
                        Delete
                    </button>
                </div>
            `}).join('');
            
            // Make sortable
            makeTaskSortable();
        }
    } catch (error) {
        console.error('Error loading task list:', error);
    }
}

// Add new task
// Add new task
async function addNewTask() {
    const icon = document.getElementById('newTaskIcon').value.trim() || '⚙️';
    const name = document.getElementById('newTaskName').value.trim();
    
    if (!name) {
        alert('Please enter a task name');
        return;
    }
    
    // Use a default color based on the icon or a standard color
    const color = '#667eea'; // Default color
    
    try {
        const response = await fetch('/api/deepwork/task-types/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ name, icon, color })
        });
        
        if (response.ok) {
            // Clear inputs
            document.getElementById('newTaskIcon').value = '⚙️';
            document.getElementById('newTaskName').value = '';
            
            // Refresh lists
            await loadTaskList();
            await loadTaskTypes();
        } else {
            const error = await response.json();
            alert('Error: ' + error.error);
        }
    } catch (error) {
        console.error('Error adding task:', error);
        alert('Failed to add task. Please try again.');
    }
}

// Update task
async function updateTask(id, newName) {
    try {
        await fetch(`/api/deepwork/task-types/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ name: newName })
        });
        await loadTaskTypes(); // Update dropdown
    } catch (error) {
        console.error('Error updating task:', error);
    }
}

async function updateTaskColor(id, color) {
    try {
        await fetch(`/api/deepwork/task-types/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ color })
        });
        await loadTaskTypes(); // Update dropdown
    } catch (error) {
        console.error('Error updating task color:', error);
    }
}

// Delete task
// Delete task - NOW ALLOWS DELETING ANY TASK
async function deleteTask(id) {
    if (!confirm('Are you sure you want to delete this task type?')) return;
    
    try {
        const response = await fetch(`/api/deepwork/task-types/${id}`, {
            method: 'DELETE',
            credentials: 'include'
        });
        
        if (response.ok) {
            await loadTaskList();
            await loadTaskTypes(); // Update dropdown
        } else {
            const error = await response.json();
            alert('Error: ' + error.error);
        }
    } catch (error) {
        console.error('Error deleting task:', error);
    }
}

// Make tasks sortable
function makeTaskSortable() {
    const taskList = document.getElementById('taskList');
    let draggedItem = null;
    
    taskList.querySelectorAll('.task-item').forEach(item => {
        item.draggable = true;
        
        item.addEventListener('dragstart', (e) => {
            draggedItem = item;
            item.style.opacity = '0.5';
        });
        
        item.addEventListener('dragend', (e) => {
            item.style.opacity = '1';
        });
        
        item.addEventListener('dragover', (e) => {
            e.preventDefault();
        });
        
        item.addEventListener('drop', (e) => {
            e.preventDefault();
            if (draggedItem && draggedItem !== item) {
                const children = [...taskList.children];
                const draggedIndex = children.indexOf(draggedItem);
                const targetIndex = children.indexOf(item);
                
                if (draggedIndex < targetIndex) {
                    taskList.insertBefore(draggedItem, item.nextSibling);
                } else {
                    taskList.insertBefore(draggedItem, item);
                }
                
                // Save new order
                saveTaskOrder();
            }
        });
    });
}

// Save task order
async function saveTaskOrder() {
    const taskList = document.getElementById('taskList');
    const orderedIds = [...taskList.children].map(item => item.dataset.id);
    
    try {
        await fetch('/api/deepwork/task-types/reorder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ orderedIds })
        });
        await loadTaskTypes(); // Update dropdown with new order
    } catch (error) {
        console.error('Error saving order:', error);
    }
}

// Show edit modal with current values
// Show edit modal with current values
function showEditModal() {
    console.log('🔵 showEditModal called');
    
    // Get current time from display
    const totalEl = document.getElementById('todayTotalCompact');
    const currentText = totalEl.textContent;
    console.log('🔵 Current display text:', currentText);
    
    // Parse hours and minutes - IMPROVED PARSING
    let hours = 0, minutes = 0;
    
    // Try different formats
    if (currentText.includes('h')) {
        // Format: "2h 15m" or "2h 15m"
        const parts = currentText.split('h');
        hours = parseInt(parts[0].trim()) || 0;
        
        if (parts[1] && parts[1].includes('m')) {
            minutes = parseInt(parts[1].replace('m', '').trim()) || 0;
        }
    } else if (currentText.includes('m')) {
        // Format: "15m" (only minutes)
        minutes = parseInt(currentText.replace('m', '').trim()) || 0;
    }
    
    console.log('🔵 Parsed - hours:', hours, 'minutes:', minutes);
    
    // Set values in modal
    document.getElementById('editHours').value = hours;
    document.getElementById('editMinutes').value = minutes;
    
    // Show modal
    document.getElementById('editModal').style.display = 'block';
}

// Close modal
function closeEditModal() {
    document.getElementById('editModal').style.display = 'none';
}

// Save edited time
// Save edited time
// Save edited time - DEBUG VERSION
// Save edited time
async function saveEdit() {
    console.log('🔵 ===== SAVE EDIT STARTED =====');
    
    const hours = parseInt(document.getElementById('editHours').value) || 0;
    const minutes = parseInt(document.getElementById('editMinutes').value) || 0;
    
    // Validate
    if (hours < 0 || hours > 24) {
        alert('Hours must be between 0 and 24');
        return;
    }
    if (minutes < 0 || minutes > 59) {
        alert('Minutes must be between 0 and 59');
        return;
    }
    
    const totalMinutes = (hours * 60) + minutes;
    
    try {
        const response = await fetch('/api/deepwork/edit-today', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ totalMinutes })
        });
        
        if (response.ok) {
            const data = await response.json();
            
            // Update display immediately
            const newHours = Math.floor(data.newTotal / 60);
            const newMins = data.newTotal % 60;
            const displayStr = newHours > 0 ? `${newHours}h ${newMins}m` : `${newMins}m`;
            document.getElementById('todayTotalCompact').textContent = displayStr;
            
            // Close modal
            closeEditModal();
            
            // Show success message
            alert('Time updated successfully!');
            
            // DO NOT refresh weekly report or category breakdown automatically
            // After successful save, refresh the graph
           await loadWeeklyStats();// Let the user see their updated time immediately
            
        } else {
            const error = await response.json();
            alert('Error: ' + error.error);
        }
    } catch (error) {
        console.error('Error saving edit:', error);
        alert('Failed to save changes');
    }
}

// Close modal when clicking outside
window.onclick = function(event) {
    const modal = document.getElementById('editModal');
    if (event.target === modal) {
        closeEditModal();
    }
}
// ===== TABS =====
let currentTab = 'tasks';

function switchTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    
    if (tab === 'tasks') {
        document.querySelector('.tab-btn:first-child').classList.add('active');
        document.getElementById('tasks-tab').classList.add('active');
        loadTasks();
    } else {
        document.querySelector('.tab-btn:last-child').classList.add('active');
        document.getElementById('notes-tab').classList.add('active');
        loadNotes();
    }
}

// ===== TASKS =====
async function loadTasks() {
    try {
        const response = await fetch('/api/tasks', { credentials: 'include' });
        const tasks = await response.json();
        
        const list = document.getElementById('tasksList');
        const completed = tasks.filter(t => t.completed).length;
        
        list.innerHTML = tasks.map(task => `
            <div class="task-item" data-id="${task._id}" draggable="true">
                <span class="drag-handle">⋮⋮</span>
                <input type="checkbox" class="task-checkbox" ${task.completed ? 'checked' : ''} 
                       onchange="toggleTask('${task._id}')">
                <span class="task-title ${task.completed ? 'completed' : ''}">${task.title}</span>
                <button class="task-delete-btn" onclick="deleteTask('${task._id}')">Delete</button>
            </div>
        `).join('');
        
        document.getElementById('tasksSummary').textContent = `✅ ${completed}/${tasks.length} completed`;
        makeTasksSortable();
        
    } catch (error) {
        console.error('Error loading tasks:', error);
    }
}

async function addTask() {
    const input = document.getElementById('newTaskInput');
    const title = input.value.trim();
    if (!title) return;
    
    try {
        await fetch('/api/tasks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ title })
        });
        input.value = '';
        loadTasks();
    } catch (error) {
        console.error('Error adding task:', error);
    }
}

async function toggleTask(id) {
    try {
        await fetch(`/api/tasks/${id}`, {
            method: 'PUT',
            credentials: 'include'
        });
        loadTasks();
    } catch (error) {
        console.error('Error toggling task:', error);
    }
}

async function deleteTask(id) {
    if (!confirm('Delete this task?')) return;
    try {
        await fetch(`/api/tasks/${id}`, {
            method: 'DELETE',
            credentials: 'include'
        });
        loadTasks();
    } catch (error) {
        console.error('Error deleting task:', error);
    }
}

function makeTasksSortable() {
    const list = document.getElementById('tasksList');
    let draggedItem = null;
    
    list.querySelectorAll('.task-item').forEach(item => {
        item.addEventListener('dragstart', (e) => {
            draggedItem = item;
            item.style.opacity = '0.5';
        });
        
        item.addEventListener('dragend', (e) => {
            item.style.opacity = '1';
        });
        
        item.addEventListener('dragover', (e) => e.preventDefault());
        
        item.addEventListener('drop', (e) => {
            e.preventDefault();
            if (draggedItem && draggedItem !== item) {
                const children = [...list.children];
                const draggedIndex = children.indexOf(draggedItem);
                const targetIndex = children.indexOf(item);
                
                if (draggedIndex < targetIndex) {
                    list.insertBefore(draggedItem, item.nextSibling);
                } else {
                    list.insertBefore(draggedItem, item);
                }
                
                const orderedIds = [...list.children].map(child => child.dataset.id);
                fetch('/api/tasks/reorder', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ orderedIds })
                });
            }
        });
    });
}

// ===== NOTES =====
let currentNoteId = null;

async function loadNotes() {
    try {
        const response = await fetch('/api/notes', { credentials: 'include' });
        const notes = await response.json();
        
        const list = document.getElementById('notesList');
        list.innerHTML = notes.map(note => `
            <div class="note-item" data-id="${note._id}">
                <div class="note-header">
                    <span class="note-title">📝 ${note.title}</span>
                    <div class="note-actions">
                        <button class="edit-btn" onclick="editNote('${note._id}')">Edit</button>
                        <button class="delete-btn" onclick="deleteNote('${note._id}')">Delete</button>
                    </div>
                </div>
                <div class="note-content">${note.content.replace(/\n/g, '<br>')}</div>
            </div>
        `).join('');
        
    } catch (error) {
        console.error('Error loading notes:', error);
    }
}

function showNoteModal() {
    currentNoteId = null;
    document.getElementById('noteModalTitle').value = '';
    document.getElementById('noteModalContent').value = '';
    document.getElementById('noteModal').style.display = 'block';
}

function closeNoteModal() {
    document.getElementById('noteModal').style.display = 'none';
}

async function saveNote() {
    const title = document.getElementById('noteModalTitle').value.trim();
    const content = document.getElementById('noteModalContent').value.trim();
    
    if (!title || !content) {
        alert('Please enter both title and content');
        return;
    }
    
    try {
        if (currentNoteId) {
            // Update existing
            await fetch(`/api/notes/${currentNoteId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ title, content })
            });
        } else {
            // Create new
            await fetch('/api/notes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ title, content })
            });
        }
        closeNoteModal();
        loadNotes();
    } catch (error) {
        console.error('Error saving note:', error);
    }
}

async function editNote(id) {
    try {
        const response = await fetch('/api/notes', { credentials: 'include' });
        const notes = await response.json();
        const note = notes.find(n => n._id === id);
        
        if (note) {
            currentNoteId = id;
            document.getElementById('noteModalTitle').value = note.title;
            document.getElementById('noteModalContent').value = note.content;
            document.getElementById('noteModal').style.display = 'block';
        }
    } catch (error) {
        console.error('Error loading note:', error);
    }
}

async function deleteNote(id) {
    if (!confirm('Delete this note?')) return;
    try {
        await fetch(`/api/notes/${id}`, {
            method: 'DELETE',
            credentials: 'include'
        });
        loadNotes();
    } catch (error) {
        console.error('Error deleting note:', error);
    }
}
// ===== TASKS SECTION COLLAPSE =====
let isTasksVisible = true;

function toggleTasksSection() {
    const row = document.querySelector('.timer-tasks-row');
    const showBtn = document.getElementById('showTasksBtn');
    const collapseBtn = document.getElementById('collapseBtn');
    
    isTasksVisible = !isTasksVisible;
    
    if (isTasksVisible) {
        // Expand
        row.classList.remove('collapsed');
        if (showBtn) showBtn.style.display = 'none';
        if (collapseBtn) collapseBtn.textContent = '▶';
    } else {
        // Collapse
        row.classList.add('collapsed');
        if (showBtn) showBtn.style.display = 'block';
        if (collapseBtn) collapseBtn.textContent = '◀';
    }
}

function expandTasks() {
    if (!isTasksVisible) {
        toggleTasksSection();
    }
}

// Optional: Auto-expand when switching tabs
const originalSwitchTab = switchTab;
window.switchTab = function(tab) {
    // If collapsed, expand first
    if (!isTasksVisible) {
        toggleTasksSection();
    }
    originalSwitchTab(tab);
};
// Add to window.onload
// ===== LOGOUT =====
async function logout() {
    try {
        await fetch('/api/auth/logout', {
            credentials: 'include'
        });
        window.location.href = '/';
    } catch (error) {
        console.error('Error logging out:', error);
        window.location.href = '/';
    }
}
