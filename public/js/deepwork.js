// Global variables
let currentSessionId = null;
let timerInterval = null;
let seconds = 0;
let taskType = 'other';
let taskDescription = '';
let timerMode = 'stopwatch'; // 'stopwatch' or 'countdown'
let countdownTotalSeconds = 0;
// Week navigation variables
let currentWeekOffset = 0; // 0 = current week, -1 = last week, -2 = two weeks ago, etc.
let isLoadingWeekly = false;
let currentWeeklyChartView = localStorage.getItem('weeklyChartView') || 'bar';
let weeklyStatsData = [];
let previousWeeklyStatsData = [];
let currentReportWeekStart = null;

function initializeDeepworkRouteState() {
    const params = new URLSearchParams(window.location.search);
    const requestedWeekOffset = Number(params.get('weekOffset'));
    if (Number.isInteger(requestedWeekOffset)) {
        currentWeekOffset = requestedWeekOffset;
        localStorage.setItem('deepworkWeekOffset', String(currentWeekOffset));
    } else {
        const savedWeekOffset = Number(localStorage.getItem('deepworkWeekOffset'));
        if (Number.isInteger(savedWeekOffset)) {
            currentWeekOffset = savedWeekOffset;
        }
    }

    if (params.get('view') === 'timeline') {
        currentWeeklyChartView = 'timeline';
        localStorage.setItem('weeklyChartView', 'timeline');
    }

    const savedTimerModePreference = localStorage.getItem('deepworkTimerModePreference');
    if (savedTimerModePreference === 'countdown' || savedTimerModePreference === 'stopwatch') {
        timerMode = savedTimerModePreference;
        applyTimerModeUI();
    }
}
// Load data on page load
// Load data on page load (KEEP THIS ONE)
// Load data on page load - PARALLEL VERSION
window.onload = async function() {
    initializeDeepworkRouteState();
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
        loadWeeklyReport(currentWeekOffset),         // Weekly progress card
        loadTodayProgress(),        // Today's compact stats
        loadCategoryBreakdown(currentWeekOffset),     // Category breakdown
        loadWeeklyConstraint(),
         loadTasks(),                // ← ADD THIS INSIDE
        loadNotes()                 // ← ADD THIS INSIDE
    ]);
    switchTab('tasks');
    console.log('✅ All dashboard data loaded in parallel!');
    console.log('🔵 Deep Work page loaded - END');
};
async function loadWeeklyConstraint() {
    const banner = document.getElementById('weeklyFocusConstraint');
    if (!banner) return;

    try {
        const response = await fetch('/api/analytics/weekly-review/constraint', {
            credentials: 'include'
        });

        if (!response.ok) throw new Error('Failed to load weekly constraint');

        const data = await response.json();
        if (data.hasConstraint && data.constraint) {
            banner.textContent = data.constraint;
            banner.style.display = 'block';
        } else {
            banner.textContent = '';
            banner.style.display = 'none';
        }
    } catch (error) {
        console.error('Error loading weekly constraint:', error);
        banner.style.display = 'none';
    }
}

// ===== CATEGORY-BASED SESSION EDITING =====

// Cached categories/sessions from the server, and which category (if any)
// currently has an add/edit session form open.
let categoryEditorData = [];
let categoryEditorFormState = {};

// Show category edit modal
async function showCategoryEditModal() {
    console.log('🔵 Opening category edit modal');

    try {
        document.getElementById('categoryEditList').innerHTML = '<div class="loading">Loading categories...</div>';
        document.getElementById('categoryEditModal').style.display = 'block';

        categoryEditorFormState = {};
        await refreshCategoryEditorData();

    } catch (error) {
        console.error('Error loading categories:', error);
        alert('Failed to load categories. Please try again.');
        closeCategoryEditModal();
    }
}

// Re-fetch today's categories/sessions from the server and re-render
async function refreshCategoryEditorData() {
    const response = await fetch('/api/deepwork/today-categories', {
        credentials: 'include'
    });

    if (!response.ok) throw new Error('Failed to load categories');

    const data = await response.json();
    console.log('📊 Today categories:', data);

    categoryEditorData = data.categories || [];
    renderCategoryEditor();
}

// Render category editor: each category shows its existing sessions (each
// editable in place) plus an "Add Session" action to log a new one.
function renderCategoryEditor() {
    const container = document.getElementById('categoryEditList');
    const categories = categoryEditorData;

    if (!categories || categories.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #666;">No categories yet. Start a timer first!</p>';
        updateCategoryEditorTotal();
        return;
    }

    container.innerHTML = categories.map(cat => renderCategoryBlock(cat)).join('');
    updateCategoryEditorTotal();
}

function renderCategoryBlock(cat) {
    const hours = Math.floor(cat.minutes / 60);
    const mins = cat.minutes % 60;
    const timeDisplay = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
    const formState = categoryEditorFormState[cat.id];
    const sessions = cat.sessions || [];

    const sessionsHtml = sessions.length
        ? sessions.map(session => renderSessionRow(cat.id, session, formState)).join('')
        : '<div class="session-row-empty">No sessions logged yet today</div>';

    const isAdding = formState?.mode === 'add';
    const addFormHtml = isAdding ? renderSessionForm(cat.id, null) : '';
    const addButtonHtml = isAdding
        ? ''
        : `<button type="button" class="add-session-btn" onclick="showAddSessionForm('${cat.id}')">+ Add Session</button>`;

    return `
        <div class="category-edit-item" data-category-id="${cat.id}">
            <div class="category-edit-header">
                <div class="category-edit-icon">${cat.icon}</div>
                <div class="category-edit-info">
                    <div class="category-edit-name" style="color: ${cat.color}">${escapeHtml(cat.name)}</div>
                    <div class="category-edit-current">Today: ${timeDisplay} · ${sessions.length} session${sessions.length === 1 ? '' : 's'}</div>
                </div>
            </div>
            <div class="session-list">${sessionsHtml}</div>
            ${addFormHtml}
            ${addButtonHtml}
        </div>
    `;
}

function renderSessionRow(categoryId, session, formState) {
    if (formState?.mode === 'edit' && formState.sessionId === session.id) {
        return renderSessionForm(categoryId, session);
    }

    const hours = Math.floor(session.minutes / 60);
    const mins = session.minutes % 60;
    const durationDisplay = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

    return `
        <div class="session-row" data-session-id="${session.id}">
            <div class="session-row-info">
                <span class="session-time-range">${session.startLabel} – ${session.endLabel}</span>
                <span class="session-duration">${durationDisplay}</span>
                ${session.taskDescription ? `<span class="session-desc">${escapeHtml(session.taskDescription)}</span>` : ''}
            </div>
            <div class="session-row-actions">
                <button type="button" title="Edit session" onclick="showEditSessionForm('${categoryId}', '${session.id}')">✏️</button>
                <button type="button" title="Delete session" onclick="deleteSession('${categoryId}', '${session.id}')">🗑️</button>
            </div>
        </div>
    `;
}

// session === null means "new session" form; otherwise it's an edit form
// pre-filled with that session's current start/end/description.
function renderSessionForm(categoryId, session) {
    const isEdit = !!session;
    const formId = isEdit ? `session-form-${session.id}` : `session-form-new-${categoryId}`;
    const startValue = isEdit ? session.startInputValue : '';
    const endValue = isEdit ? session.endInputValue : '';
    const descValue = isEdit ? session.taskDescription : '';
    const saveHandler = isEdit
        ? `saveSessionEdit('${categoryId}', '${session.id}')`
        : `saveNewSession('${categoryId}')`;

    return `
        <div class="session-form" id="${formId}">
            <div class="session-form-row">
                <label>Start
                    <input type="time" class="session-start-input" value="${startValue}">
                </label>
                <label>End
                    <input type="time" class="session-end-input" value="${endValue}">
                </label>
            </div>
            <input type="text" class="session-desc-input" placeholder="What did you work on?" value="${escapeHtml(descValue)}">
            <div class="session-form-actions">
                <button type="button" class="session-form-cancel" onclick="cancelSessionForm('${categoryId}')">Cancel</button>
                <button type="button" class="session-form-save" onclick="${saveHandler}">${isEdit ? 'Save' : 'Add'}</button>
            </div>
        </div>
    `;
}

function showAddSessionForm(categoryId) {
    categoryEditorFormState[categoryId] = { mode: 'add' };
    renderCategoryEditor();
}

function showEditSessionForm(categoryId, sessionId) {
    categoryEditorFormState[categoryId] = { mode: 'edit', sessionId };
    renderCategoryEditor();
}

function cancelSessionForm(categoryId) {
    delete categoryEditorFormState[categoryId];
    renderCategoryEditor();
}

function readSessionFormValues(formEl) {
    return {
        startTime: formEl.querySelector('.session-start-input').value,
        endTime: formEl.querySelector('.session-end-input').value,
        taskDescription: formEl.querySelector('.session-desc-input').value.trim()
    };
}

async function saveNewSession(categoryId) {
    const formEl = document.getElementById(`session-form-new-${categoryId}`);
    const { startTime, endTime, taskDescription } = readSessionFormValues(formEl);

    if (!startTime || !endTime) {
        alert('Please set both a start and end time');
        return;
    }

    try {
        const response = await fetch('/api/deepwork/session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ categoryId, startTime, endTime, taskDescription })
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            alert(data.error || 'Failed to add session');
            return;
        }

        delete categoryEditorFormState[categoryId];
        await refreshCategoryEditorData();
        await refreshDeepworkDashboardAfterEdit();

    } catch (error) {
        console.error('Error adding session:', error);
        alert('Failed to add session. Please try again.');
    }
}

async function saveSessionEdit(categoryId, sessionId) {
    const formEl = document.getElementById(`session-form-${sessionId}`);
    const { startTime, endTime, taskDescription } = readSessionFormValues(formEl);

    if (!startTime || !endTime) {
        alert('Please set both a start and end time');
        return;
    }

    try {
        const response = await fetch(`/api/deepwork/session/${sessionId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ startTime, endTime, taskDescription })
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            alert(data.error || 'Failed to update session');
            return;
        }

        delete categoryEditorFormState[categoryId];
        await refreshCategoryEditorData();
        await refreshDeepworkDashboardAfterEdit();

    } catch (error) {
        console.error('Error updating session:', error);
        alert('Failed to update session. Please try again.');
    }
}

async function deleteSession(categoryId, sessionId) {
    if (!confirm('Delete this session?')) return;

    try {
        const response = await fetch(`/api/deepwork/session/${sessionId}`, {
            method: 'DELETE',
            credentials: 'include'
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            alert(data.error || 'Failed to delete session');
            return;
        }

        delete categoryEditorFormState[categoryId];
        await refreshCategoryEditorData();
        await refreshDeepworkDashboardAfterEdit();

    } catch (error) {
        console.error('Error deleting session:', error);
        alert('Failed to delete session. Please try again.');
    }
}

function updateCategoryEditorTotal() {
    const totalMinutes = categoryEditorData.reduce((sum, cat) => sum + (cat.minutes || 0), 0);
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;

    const totalEl = document.getElementById('categoryEditTotal');
    if (totalEl) {
        totalEl.textContent = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
    }
}

async function refreshDeepworkDashboardAfterEdit() {
    await Promise.all([
        loadTodayProgress(),
        loadWeeklyStats(),
        loadWeeklyReport(currentWeekOffset),
        loadCategoryBreakdown(currentWeekOffset)
    ]);
}

// Close modal
function closeCategoryEditModal() {
    document.getElementById('categoryEditModal').style.display = 'none';
}

// Update the edit button in the UI to use the new modal
// Replace the old showEditModal function:
function showEditModal() {
    // Use the new category-based editor instead
    showCategoryEditModal();
}
// Check if there's an active session
async function checkActiveSession() {
    try {
         // First check localStorage for quick UI restoration
        const localActive = localStorage.getItem('deepWorkActive');
        const localSessionId = localStorage.getItem('deepWorkSessionId');
        const localStartTime = localStorage.getItem('deepWorkStartTime');
        const localTimerMode = localStorage.getItem('deepWorkTimerMode') || 'stopwatch';
        const localCountdownSeconds = Number(localStorage.getItem('deepWorkCountdownSeconds')) || 0;
        const localPaused = localStorage.getItem('deepWorkPaused') === 'true';
        const localPausedSeconds = Number(localStorage.getItem('deepWorkPausedSeconds')) || 0;

        if (localActive === 'true' && localSessionId && localStartTime) {
            timerMode = localTimerMode;
            countdownTotalSeconds = localCountdownSeconds;
            currentSessionId = localSessionId; // so the clock renders read-only, not editable, while restoring
            applyTimerModeUI();

            if (localPaused) {
                // Show paused UI immediately, frozen at the seconds captured when paused
                showRestoringPausedUI(localPausedSeconds);
            } else {
                const elapsedSeconds = Math.floor((Date.now() - parseInt(localStartTime)) / 1000);
                // Show restoring UI immediately
                showRestoringUI(localSessionId, elapsedSeconds);
            }
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
                taskType = data.taskType;
                taskDescription = data.taskDescription;

                if (localPaused) {
                    // The server has no concept of pause, so its elapsedSeconds keeps
                    // ticking with wall-clock time. Trust the locally frozen value instead
                    // and stay paused rather than auto-resuming the interval.
                    seconds = localPausedSeconds;
                    localStorage.setItem('deepWorkSessionId', data.sessionId);
                    updateTimerDisplay();
                    showRestoringPausedUI(localPausedSeconds);
                } else {
                    seconds = data.elapsedSeconds;

                    // Update localStorage with server data
                    localStorage.setItem('deepWorkActive', 'true');
                    localStorage.setItem('deepWorkSessionId', data.sessionId);
                    localStorage.setItem('deepWorkStartTime', Date.now() - (data.elapsedSeconds * 1000));

                    updateTimerDisplay();
                    startTimerFromExisting(data.elapsedSeconds);
                }
            } else{
                // Clear localStorage if server says no active session
                localStorage.removeItem('deepWorkActive');
                localStorage.removeItem('deepWorkSessionId');
                localStorage.removeItem('deepWorkStartTime');
                localStorage.removeItem('deepWorkTimerMode');
                localStorage.removeItem('deepWorkCountdownSeconds');
                localStorage.removeItem('deepWorkPaused');
                localStorage.removeItem('deepWorkPausedSeconds');
            }
        }
    } catch (error) {
        console.error('Error checking active session:', error);
    }
}
// ===== CATEGORY BREAKDOWN FUNCTIONS =====
async function loadCategoryBreakdown(weekOffset = 0) {
    console.log('🔵 loadCategoryBreakdown STARTED at', Date.now());
    console.log('🔵 Current URL:', window.location.href);
    console.log('🔵 Document readyState:', document.readyState);
    console.log('🔵 loadCategoryBreakdown STARTED');
    try {
        console.log('Loading category breakdown...');
         const response = await fetch(`/api/deepwork/category-breakdown?weekOffset=${weekOffset}`, {
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
    setTimerConfigDisabled(true);

    // Show approximate time while waiting for server
    seconds = elapsedSeconds;
    updateTimerDisplay();
}

// Helper function for restoring a session that was paused before refresh -
// shows the frozen time with the timer left paused, no interval started.
function showRestoringPausedUI(pausedSeconds) {
    console.log('Restoring paused session from localStorage...');
    document.getElementById('taskDescription').value = 'Restoring...';
    document.getElementById('taskDescription').disabled = true;
    document.getElementById('taskType').disabled = true;
    document.getElementById('startBtn').style.display = 'inline-block';
    document.getElementById('startBtn').textContent = 'Resume';
    document.getElementById('pauseBtn').style.display = 'none';
    document.getElementById('stopBtn').style.display = 'inline-block';
    document.querySelector('.task-input').style.opacity = '0.5';
    setTimerConfigDisabled(true);

    seconds = pausedSeconds;
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
        handleTimerTick(realSeconds);
    }, 200);

    startPingInterval();

    document.getElementById('startBtn').style.display = 'none';
    document.getElementById('pauseBtn').style.display = 'inline-block';
    document.getElementById('stopBtn').style.display = 'inline-block';
    document.getElementById('startBtn').textContent = 'Start';
    document.querySelector('.task-input').style.opacity = '0.5';
    setTimerConfigDisabled(true);
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
        // Check if we're resuming or starting fresh
    if (currentSessionId) {
        // We have an existing session, so RESUME it
        resumeTimer();
        return;
    }
    taskDescription = document.getElementById('taskDescription').value;
    taskType = document.getElementById('taskType').value;

    if (!taskDescription) {
        alert('Please describe what you\'re working on');
        return;
    }

    if (timerMode === 'countdown') {
        const totalSeconds = getCountdownSecondsFromInputs();
        if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
            alert('Set a countdown duration greater than 0');
            return;
        }
        countdownTotalSeconds = totalSeconds;
    }

    console.log('Starting timer with:', { taskType, taskDescription, timerMode, countdownTotalSeconds });

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
        addedPlannedTopicIds.clear();
        applyTimerModeUI();

        // Store the actual start time
        const sessionStartTime = Date.now();
        seconds = 0;
        updateTimerDisplay();

        localStorage.setItem('deepWorkActive', 'true');
        localStorage.setItem('deepWorkSessionId', data.sessionId);
        localStorage.setItem('deepWorkStartTime', sessionStartTime.toString());
        localStorage.setItem('deepWorkTimerMode', timerMode);
        if (timerMode === 'countdown') {
            localStorage.setItem('deepWorkCountdownSeconds', String(countdownTotalSeconds));
        } else {
            localStorage.removeItem('deepWorkCountdownSeconds');
        }
        localStorage.removeItem('deepWorkPaused');
        localStorage.removeItem('deepWorkPausedSeconds');

        // Clear any existing interval
        if (timerInterval) {
            clearInterval(timerInterval);
        }

        // Use accurate timer based on real time
        timerInterval = setInterval(() => {
            // Calculate real elapsed seconds
            const realSeconds = Math.floor((Date.now() - sessionStartTime) / 1000);
            handleTimerTick(realSeconds);
        }, 200); // Check 5 times per second for accuracy

        startPingInterval();

        document.getElementById('startBtn').style.display = 'none';
        document.getElementById('pauseBtn').style.display = 'inline-block';
        document.getElementById('stopBtn').style.display = 'inline-block';
        document.querySelector('.task-input').style.opacity = '0.5';
        setTimerConfigDisabled(true);
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
    timerInterval = null;
    // Stop pinging while paused - nothing to keep alive
    if (window.pingInterval) {
        clearInterval(window.pingInterval);
    }
    document.getElementById('pauseBtn').style.display = 'none';
    document.getElementById('startBtn').style.display = 'inline-block';
    document.getElementById('startBtn').textContent = 'Resume';

    // Persist the paused state so a refresh doesn't recompute elapsed time
    // from the original (now stale) start timestamp.
    localStorage.setItem('deepWorkPaused', 'true');
    localStorage.setItem('deepWorkPausedSeconds', String(seconds));
}
// ===== ADD THIS NEW FUNCTION =====
function resumeTimer() {
    if (!currentSessionId) {
        // If no session, start a new one
        startTimer();
        return;
    }

    const sessionStartTime = Date.now() - (seconds * 1000);

    // Clear any existing interval
    if (timerInterval) {
        clearInterval(timerInterval);
    }

    // Resume the timer from current seconds
    timerInterval = setInterval(() => {
        const realSeconds = Math.floor((Date.now() - sessionStartTime) / 1000);
        handleTimerTick(realSeconds);
    }, 200);

    // Resume ping interval
    startPingInterval();

    // Rebase the persisted start time so the excluded pause duration
    // never counts toward elapsed time again, and clear the paused flags.
    localStorage.setItem('deepWorkStartTime', String(sessionStartTime));
    localStorage.removeItem('deepWorkPaused');
    localStorage.removeItem('deepWorkPausedSeconds');

    // Update UI
    document.getElementById('startBtn').style.display = 'none';
    document.getElementById('pauseBtn').style.display = 'inline-block';
    document.getElementById('stopBtn').style.display = 'inline-block';
    document.querySelector('.task-input').style.opacity = '0.5';
    setTimerConfigDisabled(true);
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
    localStorage.removeItem('deepWorkTimerMode');
    localStorage.removeItem('deepWorkCountdownSeconds');
    localStorage.removeItem('deepWorkPaused');
    localStorage.removeItem('deepWorkPausedSeconds');
        return Promise.all([
            loadTodayProgress(),
            loadWeeklyStats(),
            loadWeeklyReport(currentWeekOffset),
            loadCategoryBreakdown(currentWeekOffset)
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
    addedPlannedTopicIds.clear();
    seconds = 0;
    updateTimerDisplay();
    applyTimerModeUI();
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }

    document.getElementById('startBtn').style.display = 'inline-block';
    document.getElementById('pauseBtn').style.display = 'none';
    document.getElementById('stopBtn').style.display = 'none';
    document.getElementById('startBtn').textContent = 'Start';
    document.querySelector('.task-input').style.opacity = '1';
    setTimerConfigDisabled(false);
    document.getElementById('taskDescription').value = '';
}

function updateTimerDisplay() {
    const displaySeconds = timerMode === 'countdown'
        ? Math.max(0, countdownTotalSeconds - seconds)
        : seconds;
    const hours = Math.floor(displaySeconds / 3600);
    const minutes = Math.floor((displaySeconds % 3600) / 60);
    const secs = displaySeconds % 60;

    document.getElementById('timerDisplayStatic').textContent =
        `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// ===== TIMER OPTIONS MENU =====
function toggleTimerActionsMenu(event) {
    if (event) event.stopPropagation();
    const actions = document.getElementById('timerActions');
    const button = document.getElementById('timerMenuBtn');
    if (!actions) return;

    const isOpen = actions.classList.toggle('open');
    if (button) button.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
}

function closeTimerActionsMenu() {
    const actions = document.getElementById('timerActions');
    const button = document.getElementById('timerMenuBtn');
    if (actions) actions.classList.remove('open');
    if (button) button.setAttribute('aria-expanded', 'false');
}

document.addEventListener('click', (event) => {
    const actions = document.getElementById('timerActions');
    if (actions && !actions.contains(event.target)) {
        closeTimerActionsMenu();
    }
});

document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeTimerActionsMenu();
});

// ===== COUNTDOWN MODE =====
function setTimerMode(mode) {
    if (currentSessionId) return; // don't allow switching modes mid-session
    timerMode = mode === 'countdown' ? 'countdown' : 'stopwatch';
    localStorage.setItem('deepworkTimerModePreference', timerMode);
    applyTimerModeUI();
    seconds = 0;
    updateTimerDisplay();
    closeTimerActionsMenu();
}

function applyTimerModeUI() {
    const stopwatchOption = document.getElementById('stopwatchModeOption');
    const countdownOption = document.getElementById('countdownModeOption');
    const staticDisplay = document.getElementById('timerDisplayStatic');
    const editableDisplay = document.getElementById('timerDisplayEditable');
    if (stopwatchOption) stopwatchOption.classList.toggle('active', timerMode === 'stopwatch');
    if (countdownOption) countdownOption.classList.toggle('active', timerMode === 'countdown');

    // The clock digits are directly editable only while a countdown is being
    // set up (idle, no session running yet). Once running it shows read-only time.
    const showEditableDigits = timerMode === 'countdown' && !currentSessionId;
    if (staticDisplay) staticDisplay.style.display = showEditableDigits ? 'none' : 'inline';
    if (editableDisplay) editableDisplay.style.display = showEditableDigits ? 'inline-flex' : 'none';

    if (showEditableDigits) {
        setCountdownInputsFromSeconds(countdownTotalSeconds > 0 ? countdownTotalSeconds : 25 * 60);
    }
}

function setCountdownInputsFromSeconds(totalSeconds) {
    const hoursInput = document.getElementById('countdownHoursInput');
    const minutesInput = document.getElementById('countdownMinutesInput');
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    if (hoursInput) hoursInput.value = String(hours).padStart(2, '0');
    if (minutesInput) minutesInput.value = String(minutes).padStart(2, '0');
}

function getCountdownSecondsFromInputs() {
    const hours = Number(document.getElementById('countdownHoursInput')?.value) || 0;
    const minutes = Number(document.getElementById('countdownMinutesInput')?.value) || 0;
    return Math.round(hours * 3600 + minutes * 60);
}

// Keep countdown digit inputs numeric-only, max 2 characters
function sanitizeDigitInput(input) {
    input.value = input.value.replace(/\D/g, '').slice(0, 2);
}

// Clamp and pad a countdown digit input on blur (hours 0-23, minutes 0-59)
function clampCountdownInput(input) {
    const max = input.id === 'countdownHoursInput' ? 23 : 59;
    let value = parseInt(input.value, 10);
    if (!Number.isFinite(value)) value = 0;
    value = Math.max(0, Math.min(max, value));
    input.value = String(value).padStart(2, '0');
}

function handleCountdownDigitKeydown(event) {
    if (event.key === 'Enter') {
        event.preventDefault();
        event.target.blur();
    }
}

function setTimerConfigDisabled(disabled) {
    const taskInputField = document.querySelector('.task-input input');
    const taskTypeSelect = document.querySelector('.task-input select');
    const stopwatchOption = document.getElementById('stopwatchModeOption');
    const countdownOption = document.getElementById('countdownModeOption');
    const hoursInput = document.getElementById('countdownHoursInput');
    const minutesInput = document.getElementById('countdownMinutesInput');
    if (taskInputField) taskInputField.disabled = disabled;
    if (taskTypeSelect) taskTypeSelect.disabled = disabled;
    if (stopwatchOption) stopwatchOption.disabled = disabled;
    if (countdownOption) countdownOption.disabled = disabled;
    if (hoursInput) hoursInput.disabled = disabled;
    if (minutesInput) minutesInput.disabled = disabled;
}

// Shared tick handler for the stopwatch and countdown clock intervals
function handleTimerTick(realSeconds) {
    if (realSeconds !== seconds) {
        seconds = realSeconds;
        updateTimerDisplay();
    }
    if (timerMode === 'countdown' && countdownTotalSeconds > 0 && seconds >= countdownTotalSeconds) {
        completeCountdown();
    }
}

// Called when a countdown reaches zero: play the alarm and auto-end the session
function completeCountdown() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
    seconds = countdownTotalSeconds;
    updateTimerDisplay();
    playAlarmSound();
    stopTimer();
}

function playAlarmSound() {
    const audio = document.getElementById('alarmAudio');
    if (!audio) return;
    audio.currentTime = 0;
    audio.play().catch(err => console.log('Alarm playback failed:', err));
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
        const [response, previousResponse] = await Promise.all([
            fetch(`/api/deepwork/weekly-stats?weekOffset=${currentWeekOffset}`, {
                credentials: 'include'
            }),
            fetch(`/api/deepwork/weekly-stats?weekOffset=${currentWeekOffset - 1}`, {
                credentials: 'include'
            })
        ]);
        
        if (!response.ok || !previousResponse.ok) {
            throw new Error('Failed to load stats');
        }
        
        const data = await response.json();
        const previousData = await previousResponse.json();
        console.log('Weekly stats:', data);
        
        // Update week range display
        const weekRangeEl = document.getElementById('weekRangeDisplay');
        const plannedBlockCount = (data.data || []).reduce((sum, day) => sum + ((day.plannedSegments || []).length), 0);
        if (weekRangeEl) {
            weekRangeEl.textContent = plannedBlockCount > 0
                ? `${data.weekRangeDisplay} - ${plannedBlockCount} scheduled`
                : data.weekRangeDisplay;
        }
        
        // Future weeks can contain reserved blocks, so keep Next available.
        if (nextBtn) {
            nextBtn.disabled = false;
        }
        if (prevBtn) {
            prevBtn.disabled = false;
        }
        
        weeklyStatsData = data.data || [];
        previousWeeklyStatsData = previousData.data || [];
        if (plannedBlockCount > 0) {
            currentWeeklyChartView = 'timeline';
            localStorage.setItem('weeklyChartView', 'timeline');
        }
        renderWeeklyActivity();
        
    } catch (error) {
        console.error('Error loading weekly stats:', error);
        // Show error in chart area
        const chart = document.getElementById('barChart');
        if (chart) {
            chart.innerHTML = '<p style="text-align: center; color: #dc3545; padding: 40px;">Failed to load data. Please try again.</p>';
        }
        const timeline = document.getElementById('weeklyTimeline');
        if (timeline) {
            timeline.innerHTML = '<p style="text-align: center; color: #dc3545; padding: 40px;">Failed to load data. Please try again.</p>';
        }
        const legend = document.getElementById('weeklyCompareLegend');
        if (legend) legend.style.display = 'none';
    } finally {
        isLoadingWeekly = false;
        if (chartContainer) chartContainer.classList.remove('loading');
    }
}

// Load previous week
async function loadPreviousWeek() {
    currentWeekOffset--;
    localStorage.setItem('deepworkWeekOffset', String(currentWeekOffset));
    await Promise.all([
        loadWeeklyStats(),
        loadWeeklyReport(currentWeekOffset),
        loadCategoryBreakdown(currentWeekOffset)
    ]);
}

// Load next week
async function loadNextWeek() {
    currentWeekOffset++;
    localStorage.setItem('deepworkWeekOffset', String(currentWeekOffset));
    await Promise.all([
        loadWeeklyStats(),
        loadWeeklyReport(currentWeekOffset),
        loadCategoryBreakdown(currentWeekOffset)
    ]);
}

// Load current week (reset to today)
async function loadCurrentWeek() {
    if (currentWeekOffset !== 0) {
        currentWeekOffset = 0;
        localStorage.setItem('deepworkWeekOffset', '0');
        await Promise.all([
            loadWeeklyStats(),
            loadWeeklyReport(0),
            loadCategoryBreakdown(0)
        ]);
    }
}

// Update renderBarChart to handle empty data

function setWeeklyChartView(view) {
    currentWeeklyChartView = view === 'timeline' ? 'timeline' : 'bar';
    localStorage.setItem('weeklyChartView', currentWeeklyChartView);
    renderWeeklyActivity();
}

function renderWeeklyActivity() {
    const barChart = document.getElementById('barChart');
    const timeline = document.getElementById('weeklyTimeline');
    const compareLegend = document.getElementById('weeklyCompareLegend');
    const barBtn = document.getElementById('barViewBtn');
    const timelineBtn = document.getElementById('timelineViewBtn');

    if (barBtn) barBtn.classList.toggle('active', currentWeeklyChartView === 'bar');
    if (timelineBtn) timelineBtn.classList.toggle('active', currentWeeklyChartView === 'timeline');

    if (barChart) barChart.style.display = currentWeeklyChartView === 'bar' ? 'flex' : 'none';
    if (timeline) timeline.style.display = currentWeeklyChartView === 'timeline' ? 'block' : 'none';
    if (compareLegend) compareLegend.style.display = currentWeeklyChartView === 'bar' ? 'flex' : 'none';

    if (currentWeeklyChartView === 'timeline') {
        renderTimelineChart(weeklyStatsData);
    } else {
        renderBarChart(weeklyStatsData, previousWeeklyStatsData);
    }
}

function renderBarChart(stats, previousStats = []) {
    const chart = document.getElementById('barChart');
    chart.innerHTML = '';
    
    if (!stats || stats.length === 0) {
        chart.innerHTML = '<p style="text-align: center; color: #666; padding: 40px;">No data yet. Start a timer to see your stats!</p>';
        return;
    }
    
    const maxMinutes = Math.max(
        ...stats.map(s => s.minutes || 0),
        ...previousStats.map(s => s.minutes || 0),
        1
    );
    
    stats.forEach((day, index) => {
        const previousDay = previousStats[index] || {};
        const currentHeight = maxMinutes > 0 ? ((day.minutes || 0) / maxMinutes) * 180 : 0;
        const previousHeight = maxMinutes > 0 ? ((previousDay.minutes || 0) / maxMinutes) * 180 : 0;
        
        const barContainer = document.createElement('div');
        barContainer.className = 'bar-container compare-bar-container';

        const barPair = document.createElement('div');
        barPair.className = 'bar-pair';

        const previousBar = document.createElement('div');
        previousBar.className = 'bar compare-bar previous-week-bar';
        previousBar.style.height = previousHeight + 'px';
        previousBar.setAttribute('data-tooltip', `Last week: ${previousDay.hours || '0.0'}h`);
        previousBar.innerHTML = `<span class="bar-top-label">${previousDay.hours || '0.0'}h</span>`;
        
        const currentBar = document.createElement('div');
        currentBar.className = 'bar compare-bar current-week-bar';
        currentBar.style.height = currentHeight + 'px';
        currentBar.setAttribute('data-tooltip', `This week: ${day.hours}h`);
        currentBar.innerHTML = `<span class="bar-top-label">${day.hours}h</span>`;
        
        const label = document.createElement('div');
        label.className = 'bar-label';
        label.textContent = day.day;
        
        const value = document.createElement('div');
        value.className = 'bar-value';
        value.textContent = day.hours + 'h';
        
        barPair.appendChild(previousBar);
        barPair.appendChild(currentBar);
        barContainer.appendChild(barPair);
        barContainer.appendChild(label);
        barContainer.appendChild(value);
        chart.appendChild(barContainer);
    });
}

function formatTimelineDuration(minutes) {
    const rounded = Math.max(0, Math.round(minutes || 0));
    const hours = Math.floor(rounded / 60);
    const mins = rounded % 60;

    if (hours > 0 && mins > 0) return `${hours}h ${mins}m`;
    if (hours > 0) return `${hours}h`;
    return `${mins}m`;
}

function formatTimelineClock(minutes) {
    const rounded = Math.max(0, Math.min(1440, Math.round(minutes || 0)));
    if (rounded === 1440) return '12:00 AM';

    const hours24 = Math.floor(rounded / 60);
    const mins = rounded % 60;
    const period = hours24 >= 12 ? 'PM' : 'AM';
    const hours12 = hours24 % 12 || 12;
    return `${hours12}:${mins.toString().padStart(2, '0')} ${period}`;
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function safeTimelineColor(color) {
    const value = String(color || '').trim();
    return /^#[0-9a-fA-F]{3,8}$/.test(value) ? value : '#667eea';
}

function getTimelineTaskName(segment) {
    const existingName = String(segment.taskName || '').trim();
    if (existingName) return existingName;

    const taskType = String(segment.taskType || 'Study').replace(/-\d{8,}$/, '');
    const name = taskType
        .split('-')
        .filter(Boolean)
        .map(part => {
            const lower = part.toLowerCase();
            if (['dsa', 'sql', 'ml', 'ai'].includes(lower)) return lower.toUpperCase();
            return lower.charAt(0).toUpperCase() + lower.slice(1);
        })
        .join(' ');

    return name || 'Study';
}

function renderTimelineChart(stats) {
    const timeline = document.getElementById('weeklyTimeline');
    if (!timeline) return;

    if (!stats || stats.length === 0) {
        timeline.innerHTML = '<p style="text-align: center; color: #666; padding: 40px;">No data yet. Start a timer to see your timeline!</p>';
        return;
    }

    const hourTicks = Array.from({ length: 25 }, (_, hour) => {
        const label = hour === 0 ? '12 AM' :
            hour === 12 ? '12 PM' :
            hour === 24 ? '12 AM' :
            hour < 12 ? `${hour} AM` :
            `${hour - 12} PM`;
        const edgeClass = hour === 0 ? ' start' : hour === 24 ? ' end' : '';
        return `<span class="timeline-hour${edgeClass}" style="left: ${(hour / 24) * 100}%">${label}</span>`;
    }).join('');

    const rows = stats.map(day => {
        const sourceSegments = day.segments || [];
        const sourcePlannedSegments = day.plannedSegments || [];

        const plannedSegments = sourcePlannedSegments.map(segment => {
            const startMinute = Math.max(0, Math.min(1440, Number(segment.startMinute) || 0));
            const endMinute = Math.max(startMinute, Math.min(1440, Number(segment.endMinute) || 0));
            const segmentMinutes = Number(segment.minutes) || Math.max(0, endMinute - startMinute);
            const startPercent = (startMinute / 1440) * 100;
            const widthPercent = Math.max(0.35, ((endMinute - startMinute) / 1440) * 100);
            const taskName = getTimelineTaskName(segment);
            const tooltip = `Scheduled: ${taskName} (${segment.startLabel || formatTimelineClock(startMinute)} - ${segment.endLabel || formatTimelineClock(endMinute)})`;
            const color = safeTimelineColor(segment.color);
            const background = timelineColorWithAlpha(color, 0.24);
            const label = segmentMinutes >= 20 ? escapeHtml(taskName) : '';

            return `
                <div class="timeline-planned-segment"
                    style="left: ${startPercent}%; width: ${widthPercent}%; color: ${color}; background: ${background};"
                    data-tooltip="${escapeHtml(tooltip)}">
                    <span>${label}</span>
                </div>
            `;
        }).join('');

        const segments = sourceSegments.map(segment => {
            const startMinute = Number(segment.startMinute) || 0;
            let endMinute = Number(segment.endMinute);

            if (!Number.isFinite(endMinute)) {
                endMinute = startMinute + (Number(segment.minutes) || 0);
            }

            if (endMinute <= startMinute && segment.minutes > 0) {
                endMinute = startMinute + Number(segment.minutes);
            }

            const clampedStart = Math.max(0, Math.min(1440, startMinute));
            const clampedEnd = Math.max(clampedStart, Math.min(1440, endMinute));
            const segmentMinutes = Number(segment.minutes) || Math.max(0, clampedEnd - clampedStart);
            const startPercent = (clampedStart / 1440) * 100;
            const widthPercent = Math.max(0.35, ((clampedEnd - clampedStart) / 1440) * 100);
            const taskName = getTimelineTaskName(segment);
            const description = String(segment.taskDescription || '').trim();
            const tooltip = `${taskName}: ${formatTimelineDuration(segmentMinutes)} (${segment.startLabel || formatTimelineClock(clampedStart)} - ${segment.endLabel || formatTimelineClock(clampedEnd)})${description ? ` | ${description}` : ''}`;
            const label = segmentMinutes >= 12 ? escapeHtml(taskName) : '';

            return `
                <div class="timeline-segment"
                    style="left: ${startPercent}%; width: ${widthPercent}%; background: ${safeTimelineColor(segment.color)};"
                    data-tooltip="${escapeHtml(tooltip)}">
                    <span>${label}</span>
                </div>
            `;
        }).join('');

        const totalDisplay = formatTimelineDuration(day.minutes);
        const emptyState = segments || plannedSegments ? '' : '<div class="timeline-empty">No study blocks</div>';

        return `
            <div class="timeline-row">
                <div class="timeline-day">
                    <strong>${escapeHtml(day.day)}</strong>
                    <span>${escapeHtml(totalDisplay)}</span>
                </div>
                <div class="timeline-gutter" aria-hidden="true"></div>
                <div class="timeline-track">
                    ${emptyState}
                    ${plannedSegments}
                    ${segments}
                </div>
            </div>
        `;
    }).join('');

    timeline.innerHTML = `
        <div class="timeline-axis">
            <span class="timeline-axis-spacer" aria-hidden="true"></span>
            <span class="timeline-axis-gutter" aria-hidden="true"></span>
            <div class="timeline-axis-track">${hourTicks}</div>
        </div>
        <div class="timeline-rows">${rows}</div>
    `;

    attachTimelineTooltips(timeline);
}

function attachTimelineTooltips(timeline) {
    const segments = timeline.querySelectorAll('.timeline-segment[data-tooltip], .timeline-planned-segment[data-tooltip]');
    segments.forEach(segment => {
        segment.addEventListener('mouseenter', showTimelineTooltip);
        segment.addEventListener('mousemove', positionTimelineTooltip);
        segment.addEventListener('mouseleave', hideTimelineTooltip);
    });
}

function timelineColorWithAlpha(color, alpha) {
    const safeColor = safeTimelineColor(color);
    const red = parseInt(safeColor.slice(1, 3), 16);
    const green = parseInt(safeColor.slice(3, 5), 16);
    const blue = parseInt(safeColor.slice(5, 7), 16);
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function showTimelineTooltip(event) {
    hideTimelineTooltip();
    const tooltip = document.createElement('div');
    tooltip.className = 'timeline-floating-tooltip';
    tooltip.id = 'timelineFloatingTooltip';
    tooltip.textContent = event.currentTarget.dataset.tooltip || '';
    document.body.appendChild(tooltip);
    positionTimelineTooltip(event);
}

function positionTimelineTooltip(event) {
    const tooltip = document.getElementById('timelineFloatingTooltip');
    if (!tooltip) return;

    const padding = 12;
    const segmentRect = event.currentTarget.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const segmentCenter = segmentRect.left + segmentRect.width / 2;
    let left = segmentCenter - tooltipRect.width / 2;
    left = Math.max(padding, Math.min(window.innerWidth - tooltipRect.width - padding, left));

    let top = segmentRect.top - tooltipRect.height - 12;
    if (top < padding) {
        top = segmentRect.bottom + 12;
    }
    top = Math.max(padding, Math.min(window.innerHeight - tooltipRect.height - padding, top));

    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
}

function hideTimelineTooltip() {
    const tooltip = document.getElementById('timelineFloatingTooltip');
    if (tooltip) tooltip.remove();
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
// ===== WEEKLY REPORT =====
async function loadWeeklyReport(weekOffset = 0) {
    try {
        console.log('Loading weekly report for offset:', weekOffset);
        const response = await fetch(`/api/deepwork/weekly-report?weekOffset=${weekOffset}`, {
            credentials: 'include'
        });
        
        if (!response.ok) {
            throw new Error('Failed to load report');
        }
        
        const report = await response.json();
        if (weekOffset !== currentWeekOffset) return;
        console.log('Weekly report:', report);
        currentReportWeekStart = report.weekStart;
        
        // Update week range
        document.getElementById('weekRange').textContent = report.weekRangeDisplay || 'This Week';
        
        // Main progress
        document.getElementById('weeklyTotal').textContent = report.totalHours + 'h';
        document.getElementById('goalTarget').textContent = (report.goal.target / 60).toFixed(1).replace(/\.0$/, '') + 'h';
        document.getElementById('goalValue').textContent = (report.goal.target / 60).toFixed(1).replace(/\.0$/, '') + 'h';
        const goalInput = document.getElementById('goalHoursInput');
        if (goalInput) goalInput.value = (report.goal.target / 60).toFixed(1).replace(/\.0$/, '');
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
async function loadUserGoal(weekOffset = currentWeekOffset) {
    try {
        const response = await fetch(`/api/deepwork/get-goal?weekOffset=${weekOffset}`, {
            credentials: 'include'
        });
        
        if (response.ok) {
            const data = await response.json();
            const goalHours = (data.weeklyGoal / 60).toFixed(1).replace(/\.0$/, '');
            
            document.getElementById('goalTarget').textContent = goalHours + 'h';
            document.getElementById('goalValue').textContent = goalHours + 'h';
            const goalInput = document.getElementById('goalHoursInput');
            if (goalInput) goalInput.value = goalHours;
        }
    } catch (error) {
        console.error('Error loading goal:', error);
    }
}

async function updateGoal(hours, weekOffset = currentWeekOffset) {
    try {
        const weeklyGoalMinutes = Math.round(Number(hours) * 60);
        
        const response = await fetch('/api/deepwork/set-goal', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ weeklyGoalMinutes, weekOffset, weekStart: currentReportWeekStart })
        });
        
        if (response.ok) {
            const data = await response.json();
            document.getElementById('goalTarget').textContent = data.weeklyGoalHours + 'h';
            document.getElementById('goalValue').textContent = data.weeklyGoalHours + 'h';
            
            // Refresh weekly report to update percentage
            await loadWeeklyReport(weekOffset);
        } else {
            const error = await response.json().catch(() => ({}));
            alert(error.error || 'Failed to update weekly target');
        }
    } catch (error) {
        console.error('Error updating goal:', error);
    }
}

function saveWeeklyGoalFromInput() {
    const input = document.getElementById('goalHoursInput');
    const hours = Number(input?.value);
    if (!Number.isFinite(hours) || hours < 1 || hours > 100) {
        alert('Please enter a valid goal between 1 and 100 hours');
        return;
    }

    document.getElementById('goalValue').textContent = `${hours}h`;
    updateGoal(hours, currentWeekOffset);
}

const goalHoursInput = document.getElementById('goalHoursInput');
if (goalHoursInput) {
    goalHoursInput.addEventListener('input', function(e) {
        document.getElementById('goalValue').textContent = `${e.target.value || 0}h`;
    });
    goalHoursInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') saveWeeklyGoalFromInput();
    });
}
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

// ===== PLANNED TOPICS (from weekly review topic plan) =====
let plannedTopicItems = [];
let addedPlannedTopicIds = new Set();
const plannedDayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function getCurrentIstMondayKey() {
    const istNow = new Date(Date.now() + 330 * 60 * 1000);
    const dayOfWeek = istNow.getUTCDay();
    const daysToSubtract = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    istNow.setUTCDate(istNow.getUTCDate() - daysToSubtract);
    return `${istNow.getUTCFullYear()}-${String(istNow.getUTCMonth() + 1).padStart(2, '0')}-${String(istNow.getUTCDate()).padStart(2, '0')}`;
}

async function openPlannedTopicsModal() {
    const categoryId = document.getElementById('taskType').value;
    if (!categoryId) {
        alert('Select a category first');
        return;
    }

    const category = (window.taskTypes || []).find(t => t.id === categoryId);
    document.getElementById('plannedTopicsCategoryLabel').textContent = category
        ? `Topics planned for ${category.name} this week.`
        : 'Topics planned for this category.';

    await loadPlannedTopics(categoryId);
    document.getElementById('plannedTopicsModal').style.display = 'block';
}

function closePlannedTopicsModal() {
    document.getElementById('plannedTopicsModal').style.display = 'none';
}

async function loadPlannedTopics(categoryId) {
    const list = document.getElementById('plannedTopicsList');
    try {
        const targetWeekStart = getCurrentIstMondayKey();
        const response = await fetch(`/api/analytics/weekly-review/topic-plan?targetWeekStart=${encodeURIComponent(targetWeekStart)}`, {
            credentials: 'include'
        });
        if (!response.ok) throw new Error('Failed to load planned topics');
        const data = await response.json();
        plannedTopicItems = (data.items || []).filter(item => item.categoryId === categoryId);
        renderPlannedTopics();
    } catch (error) {
        console.error('Error loading planned topics:', error);
        if (list) list.innerHTML = '<p class="planned-topics-empty">Unable to load planned topics.</p>';
    }
}

function renderPlannedTopics() {
    const list = document.getElementById('plannedTopicsList');
    if (!list) return;

    if (!plannedTopicItems.length) {
        list.innerHTML = '<p class="planned-topics-empty">No topics planned for this category this week.<br>Add some from the weekly review page.</p>';
        return;
    }

    const canSelect = !currentSessionId;

    const groups = new Map();
    plannedTopicItems.forEach(item => {
        const key = (item.day === null || item.day === undefined) ? 'unassigned' : item.day;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(item);
    });

    const orderedKeys = [0, 1, 2, 3, 4, 5, 6, 'unassigned'].filter(key => groups.has(key));

    list.innerHTML = orderedKeys.map(key => {
        const items = groups.get(key);
        const label = key === 'unassigned' ? 'Unassigned' : plannedDayNames[key];
        const rows = items.map(item => renderPlannedTopicRow(item, canSelect)).join('');
        return `
            <div class="planned-day-group">
                <div class="planned-day-header">
                    <span class="planned-day-pill ${key === 'unassigned' ? 'unassigned' : ''}">${label}</span>
                    <span class="planned-day-count">${items.length}</span>
                </div>
                <div class="planned-day-items">${rows}</div>
            </div>
        `;
    }).join('');
}

function renderPlannedTopicRow(item, canSelect) {
    const isAdded = addedPlannedTopicIds.has(item._id);
    return `
        <div class="planned-topic-card ${item.completed ? 'completed' : ''}" data-id="${item._id}">
            <label class="planned-topic-check">
                <input type="checkbox" ${item.completed ? 'checked' : ''} onchange="togglePlannedTopicComplete('${item._id}')">
            </label>
            <span class="planned-topic-text">${escapeHtml(item.text)}</span>
            ${item.completed ? '<span class="planned-topic-done-badge">✓ Done</span>' : ''}
            ${canSelect ? `<button type="button" class="planned-topic-use-btn ${isAdded ? 'added' : ''}" onclick="selectPlannedTopic('${item._id}')">${isAdded ? '✓ Added' : '+ Add'}</button>` : ''}
        </div>
    `;
}

function selectPlannedTopic(itemId) {
    const item = plannedTopicItems.find(entry => entry._id === itemId);
    if (!item) return;

    if (addedPlannedTopicIds.has(itemId)) {
        addedPlannedTopicIds.delete(itemId);
    } else {
        addedPlannedTopicIds.add(itemId);
    }

    const selectedTexts = plannedTopicItems
        .filter(entry => addedPlannedTopicIds.has(entry._id))
        .map(entry => entry.text);
    document.getElementById('taskDescription').value = selectedTexts.join(', ');

    renderPlannedTopics();
}

async function togglePlannedTopicComplete(itemId) {
    const item = plannedTopicItems.find(entry => entry._id === itemId);
    if (!item) return;
    const nextCompleted = !item.completed;

    try {
        const response = await fetch(`/api/analytics/weekly-review/topic-plan/${itemId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ completed: nextCompleted })
        });
        if (!response.ok) throw new Error('Failed to update topic');
        item.completed = nextCompleted;
        renderPlannedTopics();
    } catch (error) {
        console.error('Error updating planned topic:', error);
        alert('Failed to update topic. Please try again.');
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
            window.taskTypes = taskTypes;
            
            const taskList = document.getElementById('taskList');
            taskList.innerHTML = taskTypes.map(task => renderTaskTypeRow(task)).join('');

            // Make sortable
            makeTaskSortable();
        }
    } catch (error) {
        console.error('Error loading task list:', error);
    }
}

function normalizeTaskColor(color) {
    const value = String(color || '').trim();
    return /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#667eea';
}

function renderTaskTypeRow(task) {
    const id = escapeHtml(task.id);
    const rawId = String(task.id || '');
    const name = escapeHtml(task.name || 'Untitled');
    const icon = escapeHtml(task.icon || '⚙️');
    const color = normalizeTaskColor(task.color);
    const menuId = `task-menu-${rawId.replace(/[^a-zA-Z0-9_-]/g, '-')}`;

    return `
        <div class="task-type-item" data-id="${id}">
            <div class="task-drag" title="Drag to reorder">⋮⋮</div>
            <div class="task-color-swatch" style="background: ${color};" title="Timeline color"></div>
            <div class="task-icon" style="color: ${color}; background: ${color}1a;">${icon}</div>
            <div class="task-summary">
                <div class="task-name-label">${name}</div>
                <div class="task-color-label">${color}</div>
            </div>
            <div class="task-row-actions">
                <input type="color" class="task-hidden-color" value="${color}" aria-label="Change ${name} color"
                    onchange="changeTaskColor('${id}', this.value)">
                <button type="button" class="task-menu-btn" onclick="toggleTaskMenu(event, '${menuId}')" aria-label="Category options">
                    <img src="images/icons/setting.png" alt="">
                </button>
                <div class="task-menu" id="${menuId}">
                    <button type="button" onclick="editTaskName('${id}')">Change name</button>
                    <button type="button" onclick="editTaskIcon('${id}')">Change icon</button>
                    <button type="button" onclick="openTaskColorPicker(this)">Change color</button>
                    <button type="button" class="danger" onclick="deleteTaskType('${id}')">Delete</button>
                </div>
            </div>
        </div>
    `;
}

function getTaskById(id) {
    return (window.taskTypes || []).find(task => task.id === id);
}

function toggleTaskMenu(event, menuId) {
    event.stopPropagation();
    const menu = document.getElementById(menuId);
    if (!menu) return;
    const row = menu.closest('.task-type-item');
    const shouldOpen = !menu.classList.contains('open');

    document.querySelectorAll('#taskManagerModal .task-menu.open').forEach(openMenu => {
        if (openMenu !== menu) openMenu.classList.remove('open');
    });
    document.querySelectorAll('#taskManagerModal .task-type-item.menu-open').forEach(openRow => {
        if (openRow !== row) openRow.classList.remove('menu-open');
    });

    menu.classList.toggle('open', shouldOpen);
    if (row) row.classList.toggle('menu-open', shouldOpen);
}

function closeTaskMenus() {
    document.querySelectorAll('#taskManagerModal .task-menu.open').forEach(menu => {
        menu.classList.remove('open');
    });
    document.querySelectorAll('#taskManagerModal .task-type-item.menu-open').forEach(row => {
        row.classList.remove('menu-open');
    });
}

document.addEventListener('click', (event) => {
    if (!event.target.closest('#taskManagerModal .task-row-actions')) {
        closeTaskMenus();
    }
});

async function refreshTaskViews() {
    await loadTaskTypes();
    await Promise.all([
        loadWeeklyStats(),
        loadCategoryBreakdown(currentWeekOffset)
    ]);
}

async function editTaskName(id) {
    closeTaskMenus();
    const task = getTaskById(id);
    const nextName = prompt('Category name', task?.name || '');
    if (nextName === null) return;

    const name = nextName.trim();
    if (!name) {
        alert('Please enter a category name');
        return;
    }

    await updateTaskType(id, { name });
    await loadTaskList();
}

async function editTaskIcon(id) {
    closeTaskMenus();
    const task = getTaskById(id);
    const nextIcon = prompt('Category icon', task?.icon || '⚙️');
    if (nextIcon === null) return;

    const icon = nextIcon.trim() || '⚙️';
    await updateTaskType(id, { icon });
    await loadTaskList();
}

function openTaskColorPicker(button) {
    closeTaskMenus();
    const row = button.closest('.task-type-item');
    const picker = row?.querySelector('.task-hidden-color');
    if (picker) picker.click();
}

async function changeTaskColor(id, color) {
    await updateTaskType(id, { color: normalizeTaskColor(color) });
    await loadTaskList();
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
    
    const color = normalizeTaskColor(document.getElementById('newTaskColor')?.value);
    
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
            document.getElementById('newTaskColor').value = '#667eea';
            
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
async function updateTaskType(id, updates) {
    const payload = typeof updates === 'string' ? { name: updates } : updates;

    try {
        const response = await fetch(`/api/deepwork/task-types/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to update category');
        }

        await refreshTaskViews();
    } catch (error) {
        console.error('Error updating task:', error);
        alert('Failed to update category. Please try again.');
    }
}

async function updateTaskColor(id, color) {
    await changeTaskColor(id, color);
}

// Delete task
// Delete task - NOW ALLOWS DELETING ANY TASK
async function deleteTaskType(id) {
    if (!confirm('Are you sure you want to delete this task type?')) return;
    
    try {
        const response = await fetch(`/api/deepwork/task-types/${id}`, {
            method: 'DELETE',
            credentials: 'include'
        });
        
        if (response.ok) {
            await loadTaskList();
            await loadTaskTypes(); // Update dropdown
            await Promise.all([
                loadWeeklyStats(),
                loadWeeklyReport(currentWeekOffset),
                loadCategoryBreakdown(currentWeekOffset)
            ]);
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
    
    taskList.querySelectorAll('.task-type-item').forEach(item => {
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
// Close modals when clicking outside
window.onclick = function(event) {
    // Handle category edit modal
    const categoryModal = document.getElementById('categoryEditModal');
    if (event.target === categoryModal) {
        closeCategoryEditModal();
    }
    
    // Handle goal modal
    const goalModal = document.getElementById('goalModal');
    if (event.target === goalModal) {
        closeGoalModal();
    }
    
    // Handle task manager modal
    const taskModal = document.getElementById('taskManagerModal');
    if (event.target === taskModal) {
        closeTaskManager();
    }
    
    // Handle note modal
    const noteModal = document.getElementById('noteModal');
    if (event.target === noteModal) {
        closeNoteModal();
    }
};
// ===== TABS =====
let currentTab = 'tasks';

function switchTab(tab) {
    currentTab = tab;
    document.getElementById('tasksViewOption')?.classList.toggle('active', tab === 'tasks');
    document.getElementById('notesViewOption')?.classList.toggle('active', tab === 'notes');
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

    if (tab === 'tasks') {
        document.getElementById('tasks-tab').classList.add('active');
        loadTasks();
    } else {
        document.getElementById('notes-tab').classList.add('active');
        loadNotes();
    }
    closeTasksActionsMenu();
}

// ===== TASKS/NOTES OPTIONS MENU =====
function toggleTasksActionsMenu(event) {
    if (event) event.stopPropagation();
    const actions = document.getElementById('tasksActions');
    const button = document.getElementById('tasksMenuBtn');
    if (!actions) return;

    const isOpen = actions.classList.toggle('open');
    if (button) button.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
}

function closeTasksActionsMenu() {
    const actions = document.getElementById('tasksActions');
    const button = document.getElementById('tasksMenuBtn');
    if (actions) actions.classList.remove('open');
    if (button) button.setAttribute('aria-expanded', 'false');
}

document.addEventListener('click', (event) => {
    const actions = document.getElementById('tasksActions');
    if (actions && !actions.contains(event.target)) {
        closeTasksActionsMenu();
    }
});

document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeTasksActionsMenu();
});

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
                <button class="task-delete-btn" onclick="deleteTodoTask('${task._id}')">Delete</button>
            </div>
        `).join('');
        
        document.getElementById('tasksSummary').textContent = `✅ ${completed}/${tasks.length} completed`;
        makeTasksSortable();

        return { completed, total: tasks.length };
    } catch (error) {
        console.error('Error loading tasks:', error);
        return { completed: 0, total: 0 };
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
        const { completed, total } = await loadTasks();
        if (total > 0 && completed === total) {
            celebrateAllTasksDone();
        }
    } catch (error) {
        console.error('Error toggling task:', error);
    }
}

// ===== CELEBRATION (all tasks done) =====
function celebrateAllTasksDone() {
    const colors = ['#667eea', '#764ba2', '#28a745', '#ffc107', '#fd7e14', '#e83e8c', '#17a2b8'];

    const container = document.createElement('div');
    container.className = 'confetti-container';
    document.body.appendChild(container);

    const pieceCount = 90;
    for (let i = 0; i < pieceCount; i++) {
        const piece = document.createElement('div');
        piece.className = 'confetti-piece';
        const size = 6 + Math.random() * 6;
        piece.style.left = `${Math.random() * 100}vw`;
        piece.style.width = `${size}px`;
        piece.style.height = `${size * 0.4}px`;
        piece.style.background = colors[Math.floor(Math.random() * colors.length)];
        piece.style.setProperty('--confetti-drift', `${(Math.random() - 0.5) * 160}px`);
        piece.style.animationDuration = `${2.2 + Math.random() * 1.6}s`;
        piece.style.animationDelay = `${Math.random() * 0.4}s`;
        container.appendChild(piece);
    }

    const toast = document.createElement('div');
    toast.className = 'celebration-toast';
    toast.textContent = '🎉 Congrats! All tasks done! 🎉';
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));

    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 400);
    }, 2600);

    setTimeout(() => container.remove(), 4200);
}

async function deleteTodoTask(id) {
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

    isTasksVisible = !isTasksVisible;

    if (isTasksVisible) {
        // Expand
        row.classList.remove('collapsed');
        if (showBtn) showBtn.style.display = 'none';
    } else {
        // Collapse
        row.classList.add('collapsed');
        if (showBtn) showBtn.style.display = 'block';
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

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;

    sidebar.classList.toggle('collapsed');
    const isCollapsed = sidebar.classList.contains('collapsed');
    localStorage.setItem('sidebarCollapsed', isCollapsed ? 'true' : 'false');
    document.documentElement.classList.toggle('sidebar-precollapsed', isCollapsed);
}

if (localStorage.getItem('sidebarCollapsed') === 'true') {
    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.classList.add('collapsed');
    document.documentElement.classList.add('sidebar-precollapsed');
}
