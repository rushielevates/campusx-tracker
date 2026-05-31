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
    if (!currentJourney) return;
    setupStageTabs();
    renderCanvas();
}

async function loadJourneyData() {
    try {
        const response = await fetch('/api/journey', { credentials: 'include' });
        if (response.status === 401) {
            window.location.href = '/';
            return;
        }
        if (!response.ok) throw new Error('Failed to load journey');
        
        currentJourney = await response.json();
        
        // Migrate old data structure
        currentJourney.stages = Array.isArray(currentJourney.stages) ? currentJourney.stages : [];
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
        showJourneyLoadError();
    }
}

function showJourneyLoadError() {
    const container = document.getElementById('journey-canvas');
    if (!container) return;

    container.innerHTML = `
        <div class="empty-canvas">
            <p>Could not load your journey right now. Your saved journey was not overwritten.</p>
            <button class="add-main-btn" onclick="window.location.reload()">Retry</button>
        </div>
    `;
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
    
    const response = await fetch('/api/journey', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ 
            stages: currentJourney.stages, 
            activeStageId: activeStageId 
        })
    });

    if (response.status === 401) {
        window.location.href = '/';
        return;
    }

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        alert(error.error || 'Failed to save journey. Please refresh before making more changes.');
        throw new Error(error.error || 'Failed to save journey');
    }
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
                    <button class="delete-main-btn" onclick="deleteMainCard('${mainCard.id}')" title="Delete topic" aria-label="Delete topic">
                        <img src="images/icons/delete.png" alt="">
                    </button>
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

function getActiveStage() {
    return currentJourney?.stages?.find(stage => stage.id === activeStageId) || null;
}

function exportActiveStageJson() {
    const stage = getActiveStage();
    if (!stage) {
        alert('No active stage to export.');
        return;
    }

    const exportData = {
        type: 'campusx-journey-stage',
        version: 1,
        exportedAt: new Date().toISOString(),
        stage: createShareableStage(stage)
    };

    downloadBlob(
        JSON.stringify(exportData, null, 2),
        `${slugify(stage.name || 'journey-stage')}.journey.json`,
        'application/json'
    );
}

function exportActiveStagePdf() {
    const stage = getActiveStage();
    if (!stage) {
        alert('No active stage to export.');
        return;
    }

    const pdfBlob = createStagePdf(stage);
    downloadBlob(pdfBlob, `${slugify(stage.name || 'journey-stage')}.pdf`, 'application/pdf');
}

async function importStageFromFile(file) {
    if (!file) return;

    try {
        const rawText = await file.text();
        const parsed = JSON.parse(rawText);
        const sourceStage = parsed?.type === 'campusx-journey-stage' ? parsed.stage : parsed;
        const importedStage = buildImportedStage(sourceStage);

        if (!importedStage) {
            alert('This does not look like a valid Journey stage file.');
            return;
        }

        if (!currentJourney.stages) currentJourney.stages = [];
        currentJourney.stages.push(importedStage);
        activeStageId = importedStage.id;
        currentJourney.activeStageId = importedStage.id;

        await saveCurrentStage();
        setupStageTabs();
        renderCanvas();
        alert(`Imported "${importedStage.name}" into your journey.`);
    } catch (error) {
        console.error('Error importing stage:', error);
        alert('Could not import this stage. Please use a valid .journey.json file.');
    }
}

function createShareableStage(stage) {
    return {
        name: stage.name || 'Imported Stage',
        mainCards: (stage.mainCards || []).map(card => ({
            title: card.title || 'Untitled Topic',
            columnNames: {
                priority: card.columnNames?.priority || 'Priority',
                secondary: card.columnNames?.secondary || 'Secondary'
            },
            items: (card.items || []).map(item => ({
                title: item.title || 'Untitled item',
                linkTitle: item.linkTitle || '',
                linkUrl: item.linkUrl || '',
                column: item.column || 'priority',
                order: Number.isFinite(item.order) ? item.order : 0
            })),
            resources: (card.resources || []).map(resource => ({
                title: resource.title || '',
                url: resource.url || ''
            }))
        }))
    };
}

function buildImportedStage(sourceStage) {
    if (!sourceStage || !Array.isArray(sourceStage.mainCards)) return null;

    const stageId = makeId('stage');
    const nextOrder = (currentJourney?.stages?.length || 0) + 1;
    return {
        id: stageId,
        name: sourceStage.name ? `${String(sourceStage.name).trim()} (Imported)` : `Imported Stage ${nextOrder}`,
        order: nextOrder,
        mainCards: sourceStage.mainCards.map((card, cardIndex) => {
            const cardId = makeId('main');
            return {
                id: cardId,
                title: card.title || `Topic ${cardIndex + 1}`,
                columnNames: {
                    priority: card.columnNames?.priority || 'Priority',
                    secondary: card.columnNames?.secondary || 'Secondary'
                },
                items: (card.items || []).map((item, itemIndex) => ({
                    id: makeId('item'),
                    title: item.title || `Item ${itemIndex + 1}`,
                    linkTitle: item.linkTitle || '',
                    linkUrl: item.linkUrl || '',
                    column: item.column === 'secondary' ? 'secondary' : 'priority',
                    order: Number.isFinite(item.order) ? item.order : itemIndex
                })),
                resources: (card.resources || []).map(resource => ({
                    id: makeId('resource'),
                    title: resource.title || '',
                    url: resource.url || ''
                }))
            };
        })
    };
}

function buildStagePdfLines(stage) {
    const lines = [
        stage.name || 'Journey Stage',
        `Exported: ${new Date().toLocaleString()}`,
        ''
    ];

    const cards = stage.mainCards || [];
    if (cards.length === 0) {
        lines.push('No topics in this stage yet.');
        return lines;
    }

    cards.forEach((card, cardIndex) => {
        lines.push(`${cardIndex + 1}. ${card.title || 'Untitled Topic'}`);

        const priorityName = card.columnNames?.priority || 'Priority';
        const secondaryName = card.columnNames?.secondary || 'Secondary';
        appendPdfItems(lines, priorityName, (card.items || []).filter(item => item.column !== 'secondary'));
        appendPdfItems(lines, secondaryName, (card.items || []).filter(item => item.column === 'secondary'));

        const resources = card.resources || [];
        if (resources.length > 0) {
            lines.push('  Resources');
            resources.forEach(resource => {
                lines.push(`    - ${resource.title || resource.url || 'Resource'}`);
                if (resource.url) lines.push(`      ${resource.url}`);
            });
        }

        lines.push('');
    });

    return lines;
}

function createStagePdf(stage) {
    const pageWidth = 612;
    const pageHeight = 792;
    const margin = 48;
    const contentWidth = pageWidth - margin * 2;
    const objects = [];
    const pages = [];
    const addObject = content => {
        objects.push(content);
        return objects.length;
    };

    const catalogId = addObject('<< /Type /Catalog /Pages 2 0 R >>');
    const pagesId = addObject('');
    const fontId = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
    const boldFontId = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');

    let content = [];
    let annotations = [];
    let y = pageHeight - margin;

    function beginPage() {
        content = [];
        annotations = [];
        y = pageHeight - margin;
    }

    function finishPage() {
        const stream = content.join('\n');
        const contentId = addObject(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
        const annotationRefs = annotations.length > 0 ? `/Annots [${annotations.map(id => `${id} 0 R`).join(' ')}]` : '';
        const pageId = addObject(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${fontId} 0 R /F2 ${boldFontId} 0 R >> >> ${annotationRefs} /Contents ${contentId} 0 R >>`);
        pages.push(pageId);
    }

    function ensureSpace(height) {
        if (y - height >= margin) return;
        finishPage();
        beginPage();
    }

    function drawText(text, x, textY, size = 10, font = 'F1', color = [31, 41, 55]) {
        const [r, g, b] = color.map(value => (value / 255).toFixed(3));
        content.push(`BT /${font} ${size} Tf ${r} ${g} ${b} rg ${x} ${textY} Td ${pdfText(text)} Tj ET`);
    }

    function drawRect(x, rectY, width, height, fill, stroke = null) {
        const [fr, fg, fb] = fill.map(value => (value / 255).toFixed(3));
        const fillCommand = `${fr} ${fg} ${fb} rg`;
        if (stroke) {
            const [sr, sg, sb] = stroke.map(value => (value / 255).toFixed(3));
            content.push(`${fillCommand} ${sr} ${sg} ${sb} RG ${x} ${rectY} ${width} ${height} re B`);
        } else {
            content.push(`${fillCommand} ${x} ${rectY} ${width} ${height} re f`);
        }
    }

    function drawLink(text, url, x, textY, size = 9) {
        drawText(text, x, textY, size, 'F1', [67, 56, 202]);
        const rectWidth = Math.min(estimateTextWidth(text, size), contentWidth - (x - margin));
        const safeUrl = normalizeUrl(url);
        const annotationId = addObject(`<< /Type /Annot /Subtype /Link /Rect [${x} ${textY - 2} ${x + rectWidth} ${textY + size + 2}] /Border [0 0 0] /A << /S /URI /URI ${pdfText(safeUrl)} >> >>`);
        annotations.push(annotationId);
    }

    function writeWrappedText(text, x, size, maxWidth, options = {}) {
        const lines = wrapTextForWidth(text, size, maxWidth);
        lines.forEach(line => {
            ensureSpace(size + 8);
            drawText(line, x, y, size, options.font || 'F1', options.color || [31, 41, 55]);
            y -= options.lineHeight || size + 5;
        });
    }

    beginPage();

    drawRect(0, pageHeight - 124, pageWidth, 124, [247, 248, 255]);
    drawText('CampusX Journey Planner', margin, pageHeight - 58, 11, 'F2', [67, 56, 202]);
    writeWrappedText(stage.name || 'Journey Stage', margin, 24, contentWidth, { font: 'F2', color: [17, 24, 39], lineHeight: 28 });
    drawText(`Exported ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`, margin, pageHeight - 106, 9, 'F1', [102, 112, 133]);
    y = pageHeight - 148;

    const cards = stage.mainCards || [];
    if (cards.length === 0) {
        drawRect(margin, y - 70, contentWidth, 70, [255, 255, 255], [226, 232, 240]);
        drawText('No topics in this stage yet.', margin + 18, y - 40, 12, 'F2', [71, 84, 103]);
        finishPage();
        return finalizePdf(objects, catalogId, pagesId, pages);
    }

    cards.forEach((card, cardIndex) => {
        const priorityItems = (card.items || []).filter(item => item.column !== 'secondary').sort((a, b) => (a.order || 0) - (b.order || 0));
        const secondaryItems = (card.items || []).filter(item => item.column === 'secondary').sort((a, b) => (a.order || 0) - (b.order || 0));
        const resources = card.resources || [];
        const estimatedHeight = 64 + (priorityItems.length + secondaryItems.length) * 34 + resources.length * 26;

        ensureSpace(Math.min(estimatedHeight, 260));
        drawRect(margin, y - 34, contentWidth, 36, [255, 255, 255], [226, 232, 240]);
        drawText(`${cardIndex + 1}. ${card.title || 'Untitled Topic'}`, margin + 14, y - 22, 14, 'F2', [31, 41, 55]);
        y -= 52;

        writePdfColumn(card.columnNames?.priority || 'Priority', priorityItems);
        writePdfColumn(card.columnNames?.secondary || 'Secondary', secondaryItems);

        if (resources.length > 0) {
            ensureSpace(24);
            drawText('Resources', margin + 14, y, 11, 'F2', [71, 84, 103]);
            y -= 18;
            resources.forEach(resource => {
                const label = resource.title || resource.url || 'Resource';
                ensureSpace(24);
                drawText(`- ${label}`, margin + 26, y, 9, 'F1', [31, 41, 55]);
                y -= 13;
                if (resource.url) {
                    drawLink(resource.url, resource.url, margin + 36, y, 8);
                    y -= 16;
                }
            });
        }

        y -= 12;
    });

    finishPage();
    return finalizePdf(objects, catalogId, pagesId, pages);

    function writePdfColumn(title, items) {
        ensureSpace(28);
        drawRect(margin + 14, y - 18, contentWidth - 28, 22, [244, 248, 255], [219, 231, 251]);
        drawText(title, margin + 24, y - 11, 10, 'F2', [67, 56, 202]);
        y -= 30;

        if (items.length === 0) {
            ensureSpace(18);
            drawText('- No items', margin + 28, y, 9, 'F1', [102, 112, 133]);
            y -= 18;
            return;
        }

        items.forEach(item => {
            ensureSpace(36);
            drawText(`- ${item.title || 'Untitled item'}`, margin + 28, y, 10, 'F1', [31, 41, 55]);
            y -= 14;
            if (item.linkUrl) {
                const label = item.linkTitle || item.linkUrl;
                const linkText = label === item.linkUrl ? normalizeUrl(item.linkUrl) : `${label}: ${normalizeUrl(item.linkUrl)}`;
                wrapTextForWidth(linkText, 8, contentWidth - 58).forEach(line => {
                    ensureSpace(14);
                    drawLink(line, item.linkUrl, margin + 38, y, 8);
                    y -= 14;
                });
            }
            y -= 5;
        });
    }
}

function appendPdfItems(lines, heading, items) {
    const sortedItems = [...items].sort((a, b) => (a.order || 0) - (b.order || 0));
    lines.push(`  ${heading}`);
    if (sortedItems.length === 0) {
        lines.push('    - No items');
        return;
    }

    sortedItems.forEach(item => {
        lines.push(`    - ${item.title || 'Untitled item'}`);
        if (item.linkUrl) lines.push(`      Link: ${normalizeUrl(item.linkUrl)}`);
    });
}

function createTextPdf(sourceLines) {
    const wrappedLines = sourceLines.flatMap(line => wrapPdfLine(line, 88));
    const pageLineCount = 42;
    const pages = [];
    for (let i = 0; i < wrappedLines.length; i += pageLineCount) {
        pages.push(wrappedLines.slice(i, i + pageLineCount));
    }
    if (pages.length === 0) pages.push(['Journey Stage']);

    const objects = [];
    const addObject = content => {
        objects.push(content);
        return objects.length;
    };

    const catalogId = addObject('<< /Type /Catalog /Pages 2 0 R >>');
    const pagesId = addObject('');
    const fontId = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
    const pageIds = [];

    pages.forEach(pageLines => {
        const content = [
            'BT',
            '/F1 11 Tf',
            '50 790 Td',
            '14 TL',
            ...pageLines.map((line, index) => `${index === 0 ? '' : 'T* '}${pdfText(line)} Tj`),
            'ET'
        ].join('\n');
        const contentId = addObject(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
        const pageId = addObject(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`);
        pageIds.push(pageId);
    });

    objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

    let pdf = '%PDF-1.4\n';
    const offsets = [0];
    objects.forEach((object, index) => {
        offsets.push(pdf.length);
        pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    });
    const xrefOffset = pdf.length;
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    offsets.slice(1).forEach(offset => {
        pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
    });
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

    return new Blob([pdf], { type: 'application/pdf' });
}

function finalizePdf(objects, catalogId, pagesId, pageIds) {
    objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

    let pdf = '%PDF-1.4\n';
    const offsets = [0];
    objects.forEach((object, index) => {
        offsets.push(pdf.length);
        pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    });

    const xrefOffset = pdf.length;
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    offsets.slice(1).forEach(offset => {
        pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
    });
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

    return new Blob([pdf], { type: 'application/pdf' });
}

function wrapTextForWidth(text, fontSize, maxWidth) {
    const maxLength = Math.max(12, Math.floor(maxWidth / (fontSize * 0.52)));
    return wrapPdfLine(text, maxLength);
}

function estimateTextWidth(text, fontSize) {
    return String(text || '').length * fontSize * 0.52;
}

function wrapPdfLine(line, maxLength) {
    const cleanLine = String(line || '').replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '?');
    if (cleanLine.length <= maxLength) return [cleanLine];

    const words = cleanLine.split(' ');
    const lines = [];
    let current = '';
    words.forEach(word => {
        if (!current) {
            current = word;
        } else if ((current + ' ' + word).length <= maxLength) {
            current += ' ' + word;
        } else {
            lines.push(current);
            current = `  ${word}`;
        }
    });
    if (current) lines.push(current);
    return lines;
}

function pdfText(text) {
    const cleanText = String(text || '').replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '?');
    return `(${cleanText.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')})`;
}

function downloadBlob(content, filename, type) {
    const blob = content instanceof Blob ? content : new Blob([content], { type });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function makeId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function slugify(value) {
    const slug = String(value || 'journey-stage')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return slug || 'journey-stage';
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
    sidebar.classList.toggle('collapsed');
    const isCollapsed = sidebar.classList.contains('collapsed');
    localStorage.setItem('sidebarCollapsed', isCollapsed ? 'true' : 'false');
    document.documentElement.classList.toggle('sidebar-precollapsed', isCollapsed);
}

if (localStorage.getItem('sidebarCollapsed') === 'true') {
    const sidebar = document.getElementById('sidebar');
    if (sidebar) {
        sidebar.classList.add('collapsed');
        document.documentElement.classList.add('sidebar-precollapsed');
    }
}

function toggleJourneyActionsMenu(event) {
    if (event) event.stopPropagation();
    const actions = document.getElementById('stageActions');
    const button = document.getElementById('stageMenuBtn');
    if (!actions) return;

    const isOpen = actions.classList.toggle('open');
    if (button) button.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
}

function closeJourneyActionsMenu() {
    const actions = document.getElementById('stageActions');
    const button = document.getElementById('stageMenuBtn');
    if (actions) actions.classList.remove('open');
    if (button) button.setAttribute('aria-expanded', 'false');
}

document.addEventListener('click', (event) => {
    const actions = document.getElementById('stageActions');
    if (actions && !actions.contains(event.target)) {
        closeJourneyActionsMenu();
    }
});

document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeJourneyActionsMenu();
});

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
