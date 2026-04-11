// public/js/journey.js
// Journey Planner - With Draggable Items

let currentJourney = null;
let activeStageId = null;

// Load SortableJS for drag and drop
const loadSortable = () => {
    return new Promise((resolve) => {
        if (window.Sortable) {
            resolve();
            return;
        }
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/sortablejs@1.15.0/Sortable.min.js';
        script.onload = resolve;
        document.head.appendChild(script);
    });
};

document.addEventListener('DOMContentLoaded', async function() {
    await loadSortable();
    initJourneyPlanner();
});

async function initJourneyPlanner() {
    console.log('🚀 Initializing Journey Planner...');
    await loadJourneyData();
    setupStageTabs();
    renderCanvas();
}

async function loadJourneyData() {
    try {
        const response = await fetch('/api/journey', { credentials: 'include' });
        if (!response.ok) throw new Error('Failed to load journey');
        
        currentJourney = await response.json();
        
        // Migrate old data structure if needed
        currentJourney.stages.forEach(stage => {
            stage.mainCards = stage.mainCards || [];
            stage.mainCards.forEach(card => {
                // Convert old subCards to items if they exist
                if (card.subCards && !card.items) {
                    card.items = card.subCards.map((sub, index) => ({
                        id: sub.id,
                        title: sub.title,
                        completed: false,
                        order: index
                    }));
                    // Move resources from subCards to main card
                    if (!card.resources) {
                        card.resources = [];
                    }
                    card.subCards.forEach(sub => {
                        if (sub.resources) {
                            card.resources.push(...sub.resources);
                        }
                    });
                    delete card.subCards;
                }
                // Initialize if missing
                if (!card.items) card.items = [];
                if (!card.resources) card.resources = [];
            });
        });
        
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

function setupStageTabs() {
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

function renderCanvas() {
    const container = document.getElementById('journey-canvas');
    if (!container) return;
    
    const activeStage = currentJourney?.stages.find(s => s.id === activeStageId);
    const mainCards = activeStage?.mainCards || [];
    
    if (mainCards.length === 0) {
        container.innerHTML = `
            <div class="empty-canvas">
                <button class="add-main-btn" onclick="addMainCard()">
                    <span>➕</span> New Topic
                </button>
                <p>Create your first learning topic to start planning</p>
            </div>
        `;
        return;
    }
    
    let html = '<div class="main-cards-container">';
    
    mainCards.forEach((mainCard) => {
        const items = mainCard.items || [];
        const resources = mainCard.resources || [];
        
        // Sort items by order
        items.sort((a, b) => (a.order || 0) - (b.order || 0));
        
        html += `
            <div class="main-card" data-main-id="${mainCard.id}">
                <div class="main-card-header">
                    <input type="text" class="main-card-title" value="${escapeHtml(mainCard.title)}" 
                           onchange="updateMainCardTitle('${mainCard.id}', this.value)"
                           placeholder="Topic Title">
                    <button class="delete-main-btn" onclick="deleteMainCard('${mainCard.id}')">🗑️</button>
                </div>
                
                <!-- Items Section -->
                <div class="items-section">
                    <div class="section-label">
                        <span>📋</span> Planning Items
                    </div>
                    <div class="items-list" id="items-${mainCard.id}">
                        ${items.map(item => `
                            <div class="item-row" data-item-id="${item.id}">
                                <span class="drag-handle">⋮⋮</span>
                                <input type="checkbox" class="item-checkbox" 
                                       ${item.completed ? 'checked' : ''}
                                       onchange="toggleItemComplete('${mainCard.id}', '${item.id}', this.checked)">
                                <input type="text" class="item-title-input" 
                                       value="${escapeHtml(item.title)}"
                                       onchange="updateItemTitle('${mainCard.id}', '${item.id}', this.value)"
                                       placeholder="Item title">
                                <button class="delete-item-btn" onclick="deleteItem('${mainCard.id}', '${item.id}')">✕</button>
                            </div>
                        `).join('')}
                    </div>
                    <button class="add-item-btn" onclick="addItem('${mainCard.id}')">
                        <span>➕</span> Add item
                    </button>
                </div>
                
                <!-- Resources Section -->
                <div class="resources-section">
                    <div class="section-label">
                        <span>📎</span> Resources
                    </div>
                    <div class="resources-container" id="resources-${mainCard.id}">
                        ${resources.map(res => `
                            <div class="resource-chip">
                                <a href="${escapeHtml(res.url)}" target="_blank" title="${escapeHtml(res.title)}">
                                    🔗 ${escapeHtml(res.title).substring(0, 25)}${res.title.length > 25 ? '...' : ''}
                                </a>
                                <button class="remove-resource" onclick="removeResource('${mainCard.id}', '${res.id}')">✕</button>
                            </div>
                        `).join('')}
                    </div>
                    <button class="add-resource-btn" onclick="addResource('${mainCard.id}')">
                        <span>➕</span> Add link
                    </button>
                </div>
            </div>
        `;
    });
    
    html += `
            <button class="add-main-btn" onclick="addMainCard()">
                <span>➕</span> New Topic
            </button>
        </div>
    `;
    
    container.innerHTML = html;
    
    // Initialize drag and drop for each main card's items
    mainCards.forEach(card => {
        initDragAndDrop(card.id);
    });
}

function initDragAndDrop(mainCardId) {
    const itemsList = document.getElementById(`items-${mainCardId}`);
    if (!itemsList) return;
    
    new Sortable(itemsList, {
        handle: '.drag-handle',
        animation: 150,
        ghostClass: 'dragging',
        onEnd: async function() {
            await updateItemsOrder(mainCardId);
        }
    });
}

async function updateItemsOrder(mainCardId) {
    const itemsList = document.getElementById(`items-${mainCardId}`);
    if (!itemsList) return;
    
    const itemElements = itemsList.querySelectorAll('.item-row');
    const activeStage = currentJourney.stages.find(s => s.id === activeStageId);
    const mainCard = activeStage?.mainCards.find(c => c.id === mainCardId);
    
    if (!mainCard) return;
    
    // Update order based on DOM position
    itemElements.forEach((el, index) => {
        const itemId = el.dataset.itemId;
        const item = mainCard.items.find(i => i.id === itemId);
        if (item) {
            item.order = index;
        }
    });
    
    await saveCurrentStage();
}

// ===== MAIN CARD FUNCTIONS =====
async function addMainCard() {
    const activeStage = currentJourney.stages.find(s => s.id === activeStageId);
    if (!activeStage) return;
    
    if (!activeStage.mainCards) activeStage.mainCards = [];
    
    const newCard = {
        id: `main_${Date.now()}`,
        title: 'New Topic',
        items: [],
        resources: []
    };
    
    activeStage.mainCards.push(newCard);
    await saveCurrentStage();
    renderCanvas();
}

async function deleteMainCard(mainCardId) {
    if (!confirm('Delete this topic and all its items?')) return;
    
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

// ===== ITEM FUNCTIONS =====
async function addItem(mainCardId) {
    const activeStage = currentJourney.stages.find(s => s.id === activeStageId);
    const mainCard = activeStage?.mainCards.find(c => c.id === mainCardId);
    if (!mainCard) return;
    
    if (!mainCard.items) mainCard.items = [];
    
    const newItem = {
        id: `item_${Date.now()}`,
        title: 'New item',
        completed: false,
        order: mainCard.items.length
    };
    
    mainCard.items.push(newItem);
    await saveCurrentStage();
    renderCanvas();
}

async function deleteItem(mainCardId, itemId) {
    const activeStage = currentJourney.stages.find(s => s.id === activeStageId);
    const mainCard = activeStage?.mainCards.find(c => c.id === mainCardId);
    if (mainCard) {
        mainCard.items = mainCard.items.filter(i => i.id !== itemId);
        await saveCurrentStage();
        renderCanvas();
    }
}

async function updateItemTitle(mainCardId, itemId, newTitle) {
    const activeStage = currentJourney.stages.find(s => s.id === activeStageId);
    const mainCard = activeStage?.mainCards.find(c => c.id === mainCardId);
    const item = mainCard?.items.find(i => i.id === itemId);
    if (item) {
        item.title = newTitle;
        await saveCurrentStage();
    }
}

async function toggleItemComplete(mainCardId, itemId, completed) {
    const activeStage = currentJourney.stages.find(s => s.id === activeStageId);
    const mainCard = activeStage?.mainCards.find(c => c.id === mainCardId);
    const item = mainCard?.items.find(i => i.id === itemId);
    if (item) {
        item.completed = completed;
        await saveCurrentStage();
    }
}

// ===== RESOURCE FUNCTIONS =====
async function addResource(mainCardId) {
    const title = prompt('Enter resource title:', 'Documentation');
    if (!title) return;
    
    const url = prompt('Enter resource URL:', 'https://');
    if (!url) return;
    
    const activeStage = currentJourney.stages.find(s => s.id === activeStageId);
    const mainCard = activeStage?.mainCards.find(c => c.id === mainCardId);
    
    if (mainCard) {
        if (!mainCard.resources) mainCard.resources = [];
        mainCard.resources.push({
            id: `res_${Date.now()}`,
            title: title,
            url: url
        });
        await saveCurrentStage();
        renderCanvas();
    }
}

async function removeResource(mainCardId, resourceId) {
    const activeStage = currentJourney.stages.find(s => s.id === activeStageId);
    const mainCard = activeStage?.mainCards.find(c => c.id === mainCardId);
    
    if (mainCard) {
        mainCard.resources = mainCard.resources.filter(r => r.id !== resourceId);
        await saveCurrentStage();
        renderCanvas();
    }
}

// ===== STAGE FUNCTIONS =====
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
            setupStageTabs();
            await switchStage(newStage.id);
        }
    } catch (error) {
        console.error('Error adding stage:', error);
    }
}

// ===== UTILITY FUNCTIONS =====
function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>"]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        if (m === '"') return '&quot;';
        return m;
    });
}

// ===== SIDEBAR FUNCTIONS =====
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
