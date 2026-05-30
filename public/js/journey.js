// public/js/journey.js
// Journey Planner - Two Column Kanban Style

let currentJourney = null;
let activeStageId = null;
let sortableInstances = new Map();

// Load SortableJS
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
        
        // Migrate old data structure
        currentJourney.stages.forEach(stage => {
            stage.mainCards = stage.mainCards || [];
            stage.mainCards.forEach(card => {
                // Initialize column names if missing
                if (!card.columnNames) {
                    card.columnNames = { priority: 'Priority', secondary: 'Secondary' };
                }
                // Convert old items without column property
                if (card.items) {
                    card.items.forEach(item => {
                        if (!item.column) item.column = 'priority';
                        if (item.linkTitle === undefined) item.linkTitle = '';
                        if (item.linkUrl === undefined) item.linkUrl = '';
                    });
                } else {
                    card.items = [];
                }
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
        const tab = document.createElement('div');
        tab.className = `stage-tab ${activeStageId === stage.id ? 'active' : ''}`;
        tab.dataset.stageId = stage.id;
        tab.innerHTML = `
            <button type="button" class="stage-tab-label">${escapeHtml(stage.name)}</button>
            <button type="button" class="stage-delete-btn" title="Delete stage" aria-label="Delete ${escapeHtml(stage.name)}">&times;</button>
        `;
        tab.onclick = () => switchStage(stage.id);
        tab.querySelector('.stage-delete-btn').onclick = (event) => {
            event.stopPropagation();
            deleteStage(stage.id);
        };
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
        tab.classList.toggle('active', tab.dataset.stageId === activeStageId);
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
    // Destroy existing sortable instances
    sortableInstances.forEach(instance => instance.destroy());
    sortableInstances.clear();
    
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
        const columnNames = mainCard.columnNames || { priority: 'Priority', secondary: 'Secondary' };
        
        // Filter items by column
        const priorityItems = items.filter(i => i.column === 'priority').sort((a, b) => (a.order || 0) - (b.order || 0));
        const secondaryItems = items.filter(i => i.column === 'secondary').sort((a, b) => (a.order || 0) - (b.order || 0));
        
        html += `
            <div class="main-card" data-main-id="${mainCard.id}">
                <div class="main-card-header">
                    <input type="text" class="main-card-title" value="${escapeHtml(mainCard.title)}" 
                           onchange="updateMainCardTitle('${mainCard.id}', this.value)"
                           placeholder="Topic Title">
                    <button class="delete-main-btn" onclick="deleteMainCard('${mainCard.id}')">🗑️</button>
                </div>
                
                <!-- Two Column Layout -->
                <div class="columns-container">
                    <!-- Priority Column -->
                    <div class="column">
                        <div class="column-header">
                            <input type="text" class="column-title" 
                                   value="${escapeHtml(columnNames.priority)}"
                                   onchange="updateColumnName('${mainCard.id}', 'priority', this.value)"
                                   placeholder="Column name">
                            <span class="column-count">${priorityItems.length}</span>
                        </div>
                        <div class="items-list" id="priority-${mainCard.id}" data-column="priority">
                            ${priorityItems.map(item => renderItem(item, mainCard.id)).join('')}
                        </div>
                        <button class="add-item-btn" onclick="addItem('${mainCard.id}', 'priority')">
                            <span>➕</span> Add
                        </button>
                    </div>
                    
                    <!-- Secondary Column -->
                    <div class="column">
                        <div class="column-header">
                            <input type="text" class="column-title" 
                                   value="${escapeHtml(columnNames.secondary)}"
                                   onchange="updateColumnName('${mainCard.id}', 'secondary', this.value)"
                                   placeholder="Column name">
                            <span class="column-count">${secondaryItems.length}</span>
                        </div>
                        <div class="items-list" id="secondary-${mainCard.id}" data-column="secondary">
                            ${secondaryItems.map(item => renderItem(item, mainCard.id)).join('')}
                        </div>
                        <button class="add-item-btn" onclick="addItem('${mainCard.id}', 'secondary')">
                            <span>➕</span> Add
                        </button>
                    </div>
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
    
    // Initialize drag and drop for each main card's columns
    mainCards.forEach(card => {
        initDragAndDrop(card.id);
    });
}

function renderItem(item, mainCardId) {
    const hasLink = !!item.linkUrl;
    const linkTitle = item.linkTitle || item.linkUrl || '';
    const itemTitle = item.title || 'Untitled item';
    const titleControl = hasLink ? `
            <button type="button" class="item-title-link"
                    onclick="event.stopPropagation(); openItemLink('${mainCardId}', '${item.id}')"
                    title="Open link: ${escapeHtml(linkTitle)}">
                <span class="item-title-text">${escapeHtml(itemTitle)}</span>
                <span class="item-open-indicator" aria-hidden="true">&#8599;</span>
            </button>
        ` : `
            <input type="text" class="item-title-input" 
                   value="${escapeHtml(itemTitle)}"
                   onchange="updateItemTitle('${mainCardId}', '${item.id}', this.value)"
                   onclick="event.stopPropagation()"
                   title="No link attached"
                   placeholder="Item">
        `;

    return `
        <div class="item-row ${hasLink ? 'has-link' : ''}" data-item-id="${item.id}">
            <span class="drag-handle" onclick="event.stopPropagation()">&#8942;&#8942;</span>
            ${titleControl}
            <button class="item-link-btn ${hasLink ? 'linked' : ''}" onclick="event.stopPropagation(); editItemLink('${mainCardId}', '${item.id}')" title="${hasLink ? 'Edit link' : 'Add link'}">
                ${hasLink ? '&#128279;' : '+'}
            </button>
            <button class="delete-item-btn" onclick="event.stopPropagation(); deleteItem('${mainCardId}', '${item.id}')">&times;</button>
        </div>
    `;
}

function initDragAndDrop(mainCardId) {
    const priorityList = document.getElementById(`priority-${mainCardId}`);
    const secondaryList = document.getElementById(`secondary-${mainCardId}`);
    
    if (!priorityList || !secondaryList) return;
    
    // Create a shared group for dragging between columns
    const groupName = `items-${mainCardId}`;
    
    const prioritySortable = new Sortable(priorityList, {
        group: {
            name: groupName,
            put: true,
            pull: true
        },
        handle: '.drag-handle',
        animation: 150,
        ghostClass: 'dragging',
        onEnd: async function(evt) {
            await handleDragEnd(mainCardId, evt);
        }
    });
    
    const secondarySortable = new Sortable(secondaryList, {
        group: {
            name: groupName,
            put: true,
            pull: true
        },
        handle: '.drag-handle',
        animation: 150,
        ghostClass: 'dragging',
        onEnd: async function(evt) {
            await handleDragEnd(mainCardId, evt);
        }
    });
    
    // Store instances for cleanup
    sortableInstances.set(`priority-${mainCardId}`, prioritySortable);
    sortableInstances.set(`secondary-${mainCardId}`, secondarySortable);
}

async function handleDragEnd(mainCardId, evt) {
    const itemElement = evt.item;
    const itemId = itemElement.dataset.itemId;
    const newList = evt.to;
    const newColumn = newList.dataset.column;
    const newIndex = evt.newIndex;
    
    const activeStage = currentJourney.stages.find(s => s.id === activeStageId);
    const mainCard = activeStage?.mainCards.find(c => c.id === mainCardId);
    if (!mainCard) return;
    
    const item = mainCard.items.find(i => i.id === itemId);
    if (!item) return;
    
    // Update column
    item.column = newColumn;
    
    // Update orders for all items in both columns
    const priorityList = document.getElementById(`priority-${mainCardId}`);
    const secondaryList = document.getElementById(`secondary-${mainCardId}`);
    
    if (priorityList) {
        const priorityItems = priorityList.querySelectorAll('.item-row');
        priorityItems.forEach((el, index) => {
            const id = el.dataset.itemId;
            const foundItem = mainCard.items.find(i => i.id === id);
            if (foundItem) {
                foundItem.column = 'priority';
                foundItem.order = index;
            }
        });
    }
    
    if (secondaryList) {
        const secondaryItems = secondaryList.querySelectorAll('.item-row');
        secondaryItems.forEach((el, index) => {
            const id = el.dataset.itemId;
            const foundItem = mainCard.items.find(i => i.id === id);
            if (foundItem) {
                foundItem.column = 'secondary';
                foundItem.order = index;
            }
        });
    }
    
    // Update column counts
    updateColumnCounts(mainCardId);
    
    await saveCurrentStage();
}

function updateColumnCounts(mainCardId) {
    const priorityList = document.getElementById(`priority-${mainCardId}`);
    const secondaryList = document.getElementById(`secondary-${mainCardId}`);
    
    if (priorityList) {
        const count = priorityList.querySelectorAll('.item-row').length;
        const countEl = priorityList.closest('.column').querySelector('.column-count');
        if (countEl) countEl.textContent = count;
    }
    
    if (secondaryList) {
        const count = secondaryList.querySelectorAll('.item-row').length;
        const countEl = secondaryList.closest('.column').querySelector('.column-count');
        if (countEl) countEl.textContent = count;
    }
}

// ===== MAIN CARD FUNCTIONS =====
async function addMainCard() {
    const activeStage = currentJourney.stages.find(s => s.id === activeStageId);
    if (!activeStage) return;
    
    if (!activeStage.mainCards) activeStage.mainCards = [];
    
    const newCard = {
        id: `main_${Date.now()}`,
        title: 'New Topic',
        columnNames: { priority: 'Priority', secondary: 'Secondary' },
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

async function updateColumnName(mainCardId, columnKey, newName) {
    const activeStage = currentJourney.stages.find(s => s.id === activeStageId);
    const mainCard = activeStage?.mainCards.find(c => c.id === mainCardId);
    if (mainCard && mainCard.columnNames) {
        mainCard.columnNames[columnKey] = newName;
        await saveCurrentStage();
    }
}

// ===== ITEM FUNCTIONS =====
async function addItem(mainCardId, column) {
    const activeStage = currentJourney.stages.find(s => s.id === activeStageId);
    const mainCard = activeStage?.mainCards.find(c => c.id === mainCardId);
    if (!mainCard) return;
    
    if (!mainCard.items) mainCard.items = [];
    
    // Get current count for this column to set order
    const columnItems = mainCard.items.filter(i => i.column === column);
    
    const newItem = {
        id: `item_${Date.now()}`,
        title: 'New item',
        linkTitle: '',
        linkUrl: '',
        column: column,
        order: columnItems.length
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

function findJourneyItem(mainCardId, itemId) {
    const activeStage = currentJourney.stages.find(s => s.id === activeStageId);
    const mainCard = activeStage?.mainCards.find(c => c.id === mainCardId);
    const item = mainCard?.items.find(i => i.id === itemId);
    return { mainCard, item };
}

function openItemLink(mainCardId, itemId) {
    const { item } = findJourneyItem(mainCardId, itemId);
    if (item?.linkUrl) {
        window.open(normalizeUrl(item.linkUrl), '_blank', 'noopener,noreferrer');
    }
}

async function editItemLink(mainCardId, itemId) {
    const { item } = findJourneyItem(mainCardId, itemId);
    if (!item) return;

    const url = prompt('Enter item link. Leave empty to remove the link:', item.linkUrl || '');
    if (url === null) return;

    const trimmedUrl = url.trim();
    if (!trimmedUrl) {
        item.linkUrl = '';
        item.linkTitle = '';
        await saveCurrentStage();
        renderCanvas();
        return;
    }

    const title = prompt('Enter link label:', item.linkTitle || item.title || 'Open link');
    if (title === null) return;

    item.linkUrl = trimmedUrl;
    item.linkTitle = title.trim() || item.title || trimmedUrl;
    await saveCurrentStage();
    renderCanvas();
}

function normalizeUrl(url) {
    if (/^https?:\/\//i.test(url)) return url;
    return `https://${url}`;
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
    const isCollapsed = sidebar.classList.contains('collapsed');
    if (toggleBtn) {
        toggleBtn.textContent = isCollapsed ? '▶' : '◀';
    }
    localStorage.setItem('sidebarCollapsed', isCollapsed ? 'true' : 'false');
    document.documentElement.classList.toggle('sidebar-precollapsed', isCollapsed);
}

if (localStorage.getItem('sidebarCollapsed') === 'true') {
    const sidebar = document.getElementById('sidebar');
    if (sidebar) {
        sidebar.classList.add('collapsed');
        const toggleBtn = document.getElementById('sidebarToggle');
        if (toggleBtn) toggleBtn.textContent = '▶';
        document.documentElement.classList.add('sidebar-precollapsed');
    }
}

async function deleteStage(stageId) {
    if (!currentJourney?.stages || currentJourney.stages.length <= 1) {
        alert('Keep at least one stage in your journey.');
        return;
    }

    const stage = currentJourney.stages.find(s => s.id === stageId);
    if (!stage) return;

    if (!confirm(`Delete "${stage.name}" and everything inside it?`)) return;

    try {
        const response = await fetch(`/api/journey/stage/${encodeURIComponent(stageId)}`, {
            method: 'DELETE',
            credentials: 'include'
        });

        if (!response.ok) throw new Error('Failed to delete stage');

        currentJourney.stages = currentJourney.stages.filter(s => s.id !== stageId);

        if (activeStageId === stageId) {
            const nextStage = [...currentJourney.stages].sort((a, b) => a.order - b.order)[0];
            activeStageId = nextStage?.id || null;
            currentJourney.activeStageId = activeStageId;
        }

        setupStageTabs();
        renderCanvas();
        await saveCurrentStage();
    } catch (error) {
        console.error('Error deleting stage:', error);
        alert('Could not delete this stage. Please try again.');
    }
}

async function logout() {
    await fetch('/api/auth/logout', { credentials: 'include' });
    window.location.href = '/';
}
