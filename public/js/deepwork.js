// Global variables
let currentSessionId = null;
let timerInterval = null;
let seconds = 0;
let taskType = 'other';
let taskDescription = '';

// Load data on page load
window.onload = async function() {
    await loadUserInfo();
    await loadWeeklyStats();
    await loadWeeklyReport();
    await loadGoal();
};

// Load user info
async function loadUserInfo() {
    document.getElementById('username').textContent = 'CampusX Learner';
    document.getElementById('user-email').textContent = 'learner@campusx.com';
}

// ===== TIMER FUNCTIONS =====
function startTimer() {
    taskDescription = document.getElementById('taskDescription').value;
    taskType = document.getElementById('taskType').value;
    
    if (!taskDescription) {
        alert('Please describe what you\'re working on');
        return;
    }
    
    fetch('/api/deepwork/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ taskType, taskDescription })
    })
    .then(res => res.json())
    .then(data => {
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
    });
}

function pauseTimer() {
    clearInterval(timerInterval);
    document.getElementById('pauseBtn').style.display = 'none';
    document.getElementById('startBtn').style.display = 'inline-block';
    document.getElementById('startBtn').textContent = 'Resume';
}

function stopTimer() {
    clearInterval(timerInterval);
    
    // Calculate focus score based on interruptions (simplified)
    const focusScore = 100; // You can add interruption tracking later
    
    fetch(`/api/deepwork/end/${currentSessionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ 
            duration: Math.floor(seconds / 60),
            focusScore,
            interruptions: 0
        })
    })
    .then(res => res.json())
    .then(() => {
        // Reset UI
        resetTimer();
        loadWeeklyStats();
        loadWeeklyReport();
    });
}

function resetTimer() {
    currentSessionId = null;
    seconds = 0;
    updateTimerDisplay();
    clearInterval(timerInterval);
    
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
        const response = await fetch('/api/deepwork/weekly-stats', {
            credentials: 'include'
        });
        const stats = await response.json();
        
        const chart = document.getElementById('barChart');
        chart.innerHTML = '';
        
        const maxMinutes = Math.max(...stats.map(s => s.minutes), 1);
        
        stats.forEach(day => {
            const height = (day.minutes / maxMinutes) * 180;
            
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
    }
}

// ===== WEEKLY REPORT =====
async function loadWeeklyReport() {
    try {
        const response = await fetch('/api/deepwork/weekly-report', {
            credentials: 'include'
        });
        const report = await response.json();
        
        document.getElementById('weeklyTotal').textContent = report.totalHours + 'h';
        document.getElementById('weeklyAvg').textContent = 
            (report.totalMinutes / 7 / 60).toFixed(1) + 'h';
        document.getElementById('weeklySessions').textContent = report.sessionsCount;
        document.getElementById('weeklyFocus').textContent = report.avgFocusScore + '%';
        
        // Update goal progress
        const goalProgress = (report.totalMinutes / 1200) * 100; // 20 hours = 1200 minutes
        document.getElementById('goalBar').style.width = Math.min(goalProgress, 100) + '%';
        document.getElementById('goalCurrent').textContent = report.totalHours + 'h';
        
    } catch (error) {
        console.error('Error loading weekly report:', error);
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
    if (hours > 0) {
        document.getElementById('goalTarget').textContent = hours + 'h';
        // Save to user preferences (you'll need a backend endpoint)
        closeGoalModal();
    }
}

// ===== LOGOUT =====
async function logout() {
    await fetch('/api/auth/logout');
    window.location.href = '/';
}
