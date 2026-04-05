// public/js/journey.js
// Simple Journey Planner - No React Flow

// Global variables
let currentJourney = null;
let activeStageId = null;

// Load data on page load
document.addEventListener('DOMContentLoaded', function() {
    initJourneyPlanner();
});

async function initJourneyPlanner() {
    console.log('🚀 Initializing Journey Planner...');
    await loadJourneyData();
    await setupStageTabs();
    renderCanvas();
}

async function loadJourneyData() {
    try {
        const response = await fetch('/api/journey', { credentials: 'include' });
        if (!response.ok) throw new Error('Failed to load journey');
        
        currentJourney = await response.json();
        activeStageId = currentJourney.activeStageId || currentJourney.stages[0]?.id;
        console.log('Journey loaded:', currentJourney);
    } catch (error) {
        console.error('Error loading journey:', error);
        await createDefaultJourney();
    }
}

async function createDefaultJourney() {
    const defaultStages = [{
        id: `stage_${Date.now()}`,
        name: 'Stage I: Foundation',
        order: 1,
        mainCards: []
    }];
    
    try {
        const response = await fetch('/api/journey', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ stages: defaultStages, activeStageId: defaultStages[0].id })
        });
        
        if (response.ok) {
            currentJourney = await response.json();
            activeStageId = currentJourney.activeStageId;
        }
    } catch (error) {
        console.error('Error creating default journey:', error);
    }
}

async function setupStageTabs() {
    const container = document.getElementById('stageTabs');
    if (!container) return;
    
    container.innerHTML = '';
    if (!currentJourney?.stages) return;
    
    const sortedStages = [...currentJourney.stages].sort((a, b) => a.order - b.order);
    sortedStages.forEach(stage => {
        const tab = document.createElement('button');
        tab.className = `stage-tab ${activeStageId === stage.id ? 'active' : ''}`;
        tab.textContent = stage.name;
        tab.onclick = () => switchStage(stage.id);
        container.appendChild(tab);
    });
}

async function switchStage(stageId) {
    await saveCurrentStage();
    activeStageId = stageId;
    updateStageTabs();
    renderCanvas();
    
    await fetch('/api/journey', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
            stages: currentJourney.stages,
            activeStageId: activeStageId
        })
    });
}

function updateStageTabs() {
    const tabs = document.querySelectorAll('.stage-tab');
    tabs.forEach(tab => {
        const stage = currentJourney.stages.find(s => s.name === tab.textContent);
        if (stage) tab.classList.toggle('active', stage.id === activeStageId);
    });
}

async function saveCurrentStage() {
    if (!currentJourney || !activeStageId) return;
    const stageIndex = currentJourney.stages.findIndex(s => s.id === activeStageId);
    if (stageIndex !== -1) {
        await fetch('/api/journey', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ stages: currentJourney.stages, activeStageId: activeStageId })
        });
    }
}

function renderCanvas() {
    const container = document.getElementById('journey-canvas');
    if (!container) return;
    
    const activeStage = currentJourney?.stages.find(s => s.id === activeStageId);
    const mainCards = activeStage?.mainCards || [];
    
    if (mainCards.length === 0) {
        container.innerHTML = `
            <div class="empty-canvas">
                <button class="add-main-btn" onclick="addMainCard()">+ Add Main Card</button>
                <p>Click to create your first learning topic</p>
            </div>
        `;
        return;
    }
    
    let html = '<div class="main-cards-container">';
    
    mainCards.forEach((mainCard, mainIndex) => {
        const subCards = mainCard.subCards || [];
        
        html += `
            <div class="main-card">
                <div class="main-card-header">
                    <input type="text" class="main-card-title" value="${escapeHtml(mainCard.title)}" 
                           onchange="updateMainCardTitle('${mainCard.id}', this.value)">
                    <button class="delete-main-btn" onclick="deleteMainCard('${mainCard.id}')">🗑️</button>
                </div>
                <div class="sub-cards-container">
        `;
        
        subCards.forEach((subCard, subIndex) => {
            const resources = subCard.resources || [];
            html += `
                <div class="sub-card">
                    <div class="sub-card-header">
                        <input type="text" class="sub-card-title" value="${escapeHtml(subCard.title)}" 
                               onchange="updateSubCardTitle('${mainCard.id}', '${subCard.id}', this.value)">
                        <button class="delete-sub-btn" onclick="deleteSubCard('${mainCard.id}', '${subCard.id}')">🗑️</button>
                    </div>
                    <div class="resources-container">
                        ${resources.map(res => `
                            <div class="resource-chip">
                                <a href="${escapeHtml(res.url)}" target="_blank" title="${escapeHtml(res.title)}">
                                    📎 ${escapeHtml(res.title).substring(0, 20)}
                                </a>
                                <button class="remove-resource" onclick="removeResource('${mainCard.id}', '${subCard.id}', '${res.id}')">×</button>
                            </div>
                        `).join('')}
                        <button class="add-resource-btn" onclick="addResource('${mainCard.id}', '${subCard.id}')">+ Add Link</button>
                    </div>
                </div>
            `;
        });
        
        html += `
                    <button class="add-sub-btn" onclick="addSubCard('${mainCard.id}')">+ Add Sub Card</button>
                </div>
            </div>
        `;
    });
    
    html += `
            <button class="add-main-btn" onclick="addMainCard()">+ Add Main Card</button>
        </div>
    `;
    
    container.innerHTML = html;
}

// ===== CARD MANAGEMENT FUNCTIONS =====
async function addMainCard() {
    const activeStage = currentJourney.stages.find(s => s.id === activeStageId);
    if (!activeStage) return;
    
    if (!activeStage.mainCards) activeStage.mainCards = [];
    
    const newCard = {
        id: `main_${Date.now()}`,
        title: 'New Topic',
        subCards: []
    };
    
    activeStage.mainCards.push(newCard);
    await saveCurrentStage();
    renderCanvas();
}

async function deleteMainCard(mainCardId) {
    if (!confirm('Delete this main card and all its sub-cards?')) return;
    
    const activeStage = currentJourney.stages.find(s => s.id === activeStageId);
    if (!activeStage) return;
    
    activeStage.mainCards = activeStage.mainCards.filter(c => c.id !== mainCardId);
    await saveCurrentStage();
    renderCanvas();
}

async function updateMainCardTitle(mainCardId, newTitle) {
    const activeStage = currentJourney.stages.find(s => s.id === activeStageId);
    const mainCard = activeStage?.mainCards.find(c => c.id === mainCardId);
    if (mainCard) {
        mainCard.title = newTitle;
        await saveCurrentStage();
    }
}

async function addSubCard(mainCardId) {
    const activeStage = currentJourney.stages.find(s => s.id === activeStageId);
    const mainCard = activeStage?.mainCards.find(c => c.id === mainCardId);
    if (!mainCard) return;
    
    if (!mainCard.subCards) mainCard.subCards = [];
    
    const newSubCard = {
        id: `sub_${Date.now()}`,
        title: 'New Section',
        resources: []
    };
    
    mainCard.subCards.push(newSubCard);
    await saveCurrentStage();
    renderCanvas();
}

async function deleteSubCard(mainCardId, subCardId) {
    if (!confirm('Delete this sub-card and all its resources?')) return;
    
    const activeStage = currentJourney.stages.find(s => s.id === activeStageId);
    const mainCard = activeStage?.mainCards.find(c => c.id === mainCardId);
    if (mainCard) {
        mainCard.subCards = mainCard.subCards.filter(s => s.id !== subCardId);
        await saveCurrentStage();
        renderCanvas();
    }
}

async function updateSubCardTitle(mainCardId, subCardId, newTitle) {
    const activeStage = currentJourney.stages.find(s => s.id === activeStageId);
    const mainCard = activeStage?.mainCards.find(c => c.id === mainCardId);
    const subCard = mainCard?.subCards.find(s => s.id === subCardId);
    if (subCard) {
        subCard.title = newTitle;
        await saveCurrentStage();
    }
}

async function addResource(mainCardId, subCardId) {
    const title = prompt('Enter resource title:', 'Resource Name');
    if (!title) return;
    
    const url = prompt('Enter resource URL:', 'https://');
    if (!url) return;
    
    const activeStage = currentJourney.stages.find(s => s.id === activeStageId);
    const mainCard = activeStage?.mainCards.find(c => c.id === mainCardId);
    const subCard = mainCard?.subCards.find(s => s.id === subCardId);
    
    if (subCard) {
        if (!subCard.resources) subCard.resources = [];
        subCard.resources.push({
            id: `res_${Date.now()}`,
            title: title,
            url: url
        });
        await saveCurrentStage();
        renderCanvas();
    }
}

async function removeResource(mainCardId, subCardId, resourceId) {
    const activeStage = currentJourney.stages.find(s => s.id === activeStageId);
    const mainCard = activeStage?.mainCards.find(c => c.id === mainCardId);
    const subCard = mainCard?.subCards.find(s => s.id === subCardId);
    
    if (subCard) {
        subCard.resources = subCard.resources.filter(r => r.id !== resourceId);
        await saveCurrentStage();
        renderCanvas();
    }
}

async function addNewStage() {
    const stageName = prompt('Enter stage name:', `Stage ${(currentJourney?.stages?.length || 0) + 1}`);
    if (!stageName) return;
    
    try {
        const response = await fetch('/api/journey/stage', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ name: stageName })
        });
        
        if (response.ok) {
            const newStage = await response.json();
            if (!currentJourney.stages) currentJourney.stages = [];
            currentJourney.stages.push(newStage);
            await setupStageTabs();
            await switchStage(newStage.id);
        }
    } catch (error) {
        console.error('Error adding stage:', error);
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

// Update the Journey model to use mainCards structure
// In models/Journey.js, change stages.nodes to stages.mainCards

// Sidebar functions
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const toggleBtn = document.getElementById('sidebarToggle');
    sidebar.classList.toggle('collapsed');
    if (toggleBtn) {
        toggleBtn.textContent = sidebar.classList.contains('collapsed') ? '▶' : '◀';
    }
    localStorage.setItem('sidebarCollapsed', sidebar.classList.contains('collapsed'));
}

if (localStorage.getItem('sidebarCollapsed') === 'true') {
    const sidebar = document.getElementById('sidebar');
    if (sidebar) {
        sidebar.classList.add('collapsed');
        const toggleBtn = document.getElementById('sidebarToggle');
        if (toggleBtn) toggleBtn.textContent = '▶';
    }
}

async function logout() {
    await fetch('/api/auth/logout', { credentials: 'include' });
    window.location.href = '/';
}
