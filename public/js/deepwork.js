// Global variables
let currentSessionId = null;
let timerInterval = null;
let seconds = 0;
let taskType = 'other';
let taskDescription = '';

// Load data on page load
window.onload = async function() {
    console.log('Deep Work page loaded');
    await loadUserInfo();
    await loadWeeklyStats();
    await loadWeeklyReport();
    // await loadGoal(); // Comment out until implemented
};

// Load user info
async function loadUserInfo() {
    try {
        // Try to get real user data
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
        // Fallback to mock data
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
        seconds = 0;
        updateTimerDisplay();
        
        // Start timer
        timerInterval = setInterval(() => {
            seconds++;
            updateTimerDisplay();
        }, 1000);
        
        // Update UI
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

function pauseTimer() {
    clearInterval(timerInterval);
    document.getElementById('pauseBtn').style.display = 'none';
    document.getElementById('startBtn').style.display = 'inline-block';
    document.getElementById('startBtn').textContent = 'Resume';
}

function stopTimer() {
    if (!currentSessionId) {
        resetTimer();
        return;
    }
    
    clearInterval(timerInterval);
    
    // Calculate focus score based on interruptions (simplified)
    const focusScore = 100; // You can add interruption tracking later
    const durationMinutes = Math.max(1, Math.floor(seconds / 60)); // At least 1 minute
    
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
        // Reset UI
        resetTimer();
        // Refresh stats
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
async function loadWeeklyStats() {
    try {
        console.log('Loading weekly stats...');
        const response = await fetch('/api/deepwork/weekly-stats', {
            credentials: 'include'
        });
        
        if (!response.ok) {
            throw new Error('Failed to load stats');
        }
        
        const stats = await response.json();
        console.log('Weekly stats:', stats);
        
        const chart = document.getElementById('barChart');
        chart.innerHTML = '';
        
        // If no data, show message
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
        
    } catch (error) {
        console.error('Error loading weekly stats:', error);
        // Show mock data for testing
        showMockChart();
    }
}

// Temporary function for testing - REMOVE when backend is ready
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
        
        document.getElementById('weeklyTotal').textContent = report.totalHours + 'h';
        
        const dailyAvg = (report.totalMinutes / 7 / 60).toFixed(1);
        document.getElementById('weeklyAvg').textContent = dailyAvg + 'h';
        
        document.getElementById('weeklySessions').textContent = report.sessionsCount || '0';
        document.getElementById('weeklyFocus').textContent = (report.avgFocusScore || '0') + '%';
        
        // Update goal progress
        const goalMinutes = 1200; // 20 hours default
        const goalProgress = ((report.totalMinutes || 0) / goalMinutes) * 100;
        document.getElementById('goalBar').style.width = Math.min(goalProgress, 100) + '%';
        document.getElementById('goalCurrent').textContent = report.totalHours || '0h';
        
    } catch (error) {
        console.error('Error loading weekly report:', error);
        // Show mock data for testing
        document.getElementById('weeklyTotal').textContent = '12.5h';
        document.getElementById('weeklyAvg').textContent = '1.8h';
        document.getElementById('weeklySessions').textContent = '18';
        document.getElementById('weeklyFocus').textContent = '92%';
        document.getElementById('goalBar').style.width = '62%';
        document.getElementById('goalCurrent').textContent = '12.5h';
    }
}

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
        // Save to user preferences (you'll need a backend endpoint)
        console.log('Setting goal to:', hours);
        
        // You can add API call here later
        // fetch('/api/deepwork/set-goal', {
        //     method: 'POST',
        //     headers: { 'Content-Type': 'application/json' },
        //     credentials: 'include',
        //     body: JSON.stringify({ weeklyGoal: hours * 60 })
        // });
        
        closeGoalModal();
    } else {
        alert('Please enter a valid goal (1-100 hours)');
    }
}

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
