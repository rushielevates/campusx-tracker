// public/js/journey.js
// React Flow Journey Planner - Complete Implementation

// Global variables
let currentJourney = null;
let activeStageId = null;
let nodes = [];
let edges = [];

// ===== NODE COMPONENTS =====
const TrackNode = ({ data, id }) => {
    return React.createElement('div', {
        className: 'track-node',
        style: { background: '#2d2d44', borderRadius: '12px', padding: '16px', width: '220px', border: '1px solid #4a4a6a' }
    },
        React.createElement('div', { style: { color: 'white', fontWeight: 'bold', marginBottom: '8px' } }, data.title),
        React.createElement('div', { style: { color: '#a0a0c0', fontSize: '12px', marginBottom: '12px' } }, data.status || 'Not Started'),
        React.createElement('div', { style: { display: 'flex', gap: '8px', marginTop: '8px' } },
            React.createElement('button', {
                onClick: () => addSiblingNode(id),
                style: { background: 'rgba(255,255,255,0.1)', border: 'none', color: 'white', padding: '4px 8px', borderRadius: '4px', fontSize: '11px', cursor: 'pointer' }
            }, '➕ Parallel'),
            React.createElement('button', {
                onClick: () => addChildNode(id),
                style: { background: 'rgba(255,255,255,0.1)', border: 'none', color: 'white', padding: '4px 8px', borderRadius: '4px', fontSize: '11px', cursor: 'pointer' }
            }, '➕ Step')
        )
    );
};

const StepNode = ({ data, id }) => {
    return React.createElement('div', {
        className: 'step-node',
        style: { background: '#1e1e2e', borderRadius: '10px', padding: '12px', width: '200px', border: '1px solid #3a3a5a' }
    },
        React.createElement('div', { style: { color: 'white', fontWeight: '500', marginBottom: '8px' } }, data.title),
        data.url && React.createElement('a', {
            href: data.url,
            target: '_blank',
            style: { color: '#60a5fa', fontSize: '11px', textDecoration: 'none', display: 'block', marginBottom: '8px' }
        }, '🔗 Link'),
        data.progress && React.createElement('div', { style: { color: '#a0a0c0', fontSize: '11px', marginBottom: '8px' } }, data.progress),
        React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' } },
            (data.resources || []).map(res => renderResourceCard(res))
        ),
        React.createElement('button', {
            onClick: () => addResource(id),
            style: { background: 'none', border: '1px dashed #5a5a7a', color: '#a0a0c0', fontSize: '10px', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer', marginTop: '8px', width: '100%' }
        }, '+ Add Resource')
    );
};

const renderResourceCard = (resource) => {
    return React.createElement('div', {
        key: resource.id,
        style: { position: 'relative', display: 'inline-block' }
    },
        React.createElement('a', {
            href: resource.url,
            target: '_blank',
            style: { background: '#2d2d44', color: 'white', fontSize: '10px', padding: '4px 8px', borderRadius: '4px', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px' }
        }, '📎 ' + (resource.title.substring(0, 3) || 'Link')),
        React.createElement('div', {
            style: { position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)', background: '#1a1a2e', color: 'white', padding: '4px 8px', borderRadius: '4px', fontSize: '10px', whiteSpace: 'nowrap', zIndex: 100, display: 'none', marginBottom: '5px' }
        }, resource.title)
    );
};

// ===== INITIALIZATION =====
document.addEventListener('DOMContentLoaded', function() {
    initJourneyPlanner();
});

async function initJourneyPlanner() {
    console.log('🚀 Initializing Journey Planner...');
    await loadJourneyData();
    await setupStageTabs();
    initReactFlow();
}

async function loadJourneyData() {
    try {
        const response = await fetch('/api/journey', { credentials: 'include' });
        if (!response.ok) throw new Error('Failed to load journey');
        
        currentJourney = await response.json();
        activeStageId = currentJourney.activeStageId || currentJourney.stages[0]?.id;
        
        const activeStage = currentJourney.stages.find(s => s.id === activeStageId);
        if (activeStage) {
            nodes = activeStage.nodes || [];
            edges = activeStage.edges || [];
        }
    } catch (error) {
        console.error('Error loading journey:', error);
        await createDefaultJourney();
    }
}

async function createDefaultJourney() {
    console.log('Creating default journey...');
    const defaultStages = [{
        id: `stage_${Date.now()}`,
        name: 'Stage I: Foundation',
        order: 1,
        nodes: [],
        edges: []
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
            nodes = [];
            edges = [];
        }
    } catch (error) {
        console.error('Error creating default journey:', error);
    }
}

async function setupStageTabs() {
    const stageTabsContainer = document.getElementById('stageTabs');
    if (!stageTabsContainer) return;
    
    stageTabsContainer.innerHTML = '';
    if (!currentJourney?.stages) return;
    
    const sortedStages = [...currentJourney.stages].sort((a, b) => a.order - b.order);
    sortedStages.forEach(stage => {
        const tab = document.createElement('button');
        tab.className = `stage-tab ${activeStageId === stage.id ? 'active' : ''}`;
        tab.textContent = stage.name;
        tab.onclick = () => switchStage(stage.id);
        stageTabsContainer.appendChild(tab);
    });
}

async function switchStage(stageId) {
    await saveCurrentStage();
    activeStageId = stageId;
    
    const stage = currentJourney.stages.find(s => s.id === stageId);
    if (stage) {
        nodes = stage.nodes || [];
        edges = stage.edges || [];
        if (window.reactFlowInstance) {
            window.reactFlowInstance.setNodes(nodes);
            window.reactFlowInstance.setEdges(edges);
        }
        updateStageTabs();
    }
    
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
        currentJourney.stages[stageIndex].nodes = nodes;
        currentJourney.stages[stageIndex].edges = edges;
        await fetch('/api/journey', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ stages: currentJourney.stages, activeStageId: activeStageId })
        });
    }
}

async function addNewStage() {
    const stageName = prompt('Enter stage name:', `Stage ${(currentJourney?.stages?.length || 0) + 1}`);
    if (!stageName) return;
    
    const addBtn = document.querySelector('.add-stage-btn');
    if (addBtn) {
        addBtn.disabled = true;
        addBtn.textContent = 'Adding...';
    }
    
    try {
        const response = await fetch('/api/journey/stage', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ name: stageName })
        });
        
        if (!response.ok) throw new Error('Failed to add stage');
        
        const newStage = await response.json();
        if (!currentJourney.stages) currentJourney.stages = [];
        currentJourney.stages.push(newStage);
        await setupStageTabs();
        await switchStage(newStage.id);
    } catch (error) {
        console.error('Error adding stage:', error);
        alert('Failed to add stage: ' + error.message);
    } finally {
        if (addBtn) {
            addBtn.disabled = false;
            addBtn.textContent = '+ Add Stage';
        }
    }
}

// ===== REACT FLOW RENDERING =====
function initReactFlow() {
    if (typeof React === 'undefined' || typeof ReactDOM === 'undefined') {
        setTimeout(initReactFlow, 100);
        return;
    }
    
    const container = document.getElementById('journey-canvas');
    if (!container) return;
    
    const root = ReactDOM.createRoot(container);
    root.render(
        React.createElement(ReactFlowProvider, null,
            React.createElement(ReactFlowComponent, { initialNodes: nodes, initialEdges: edges })
        )
    );
}

function ReactFlowComponent({ initialNodes, initialEdges }) {
    const [rfNodes, setRfNodes] = React.useState(initialNodes);
    const [rfEdges, setRfEdges] = React.useState(initialEdges);
    
    React.useEffect(() => {
        setRfNodes(initialNodes);
        setRfEdges(initialEdges);
    }, [initialNodes, initialEdges]);
    
    // If no nodes, show "Add First Track" button
    if (rfNodes.length === 0) {
        return React.createElement('div', { 
            style: { 
                width: '100%', 
                height: '100%', 
                background: '#1a1a2e',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexDirection: 'column'
            }
        },
            React.createElement('button', {
                onClick: () => addFirstTrack(),
                style: {
                    padding: '16px 32px',
                    fontSize: '18px',
                    background: '#667eea',
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    cursor: 'pointer'
                }
            }, '+ Add First Track'),
            React.createElement('div', { style: { color: '#a0a0c0', marginTop: '16px', fontSize: '14px' } },
                'Click to create your first learning track'
            )
        );
    }
    
    return React.createElement('div', { 
        style: { width: '100%', height: '100%', background: '#1a1a2e', position: 'relative', padding: '20px' }
    },
        React.createElement('div', { style: { position: 'absolute', top: '10px', left: '10px', zIndex: 10, color: '#a0a0c0', fontSize: '12px' } },
            '💡 Click +Parallel to add tracks, +Step to add subtasks'
        ),
        React.createElement('div', { style: { position: 'relative' } },
            rfNodes.map(node => {
                if (node.type === 'trackNode') {
                    return React.createElement(TrackNode, { key: node.id, data: node.data, id: node.id });
                } else if (node.type === 'stepNode') {
                    return React.createElement(StepNode, { key: node.id, data: node.data, id: node.id });
                }
                return null;
            })
        )
    );
}

function ReactFlowProvider({ children }) {
    return React.createElement('div', { style: { width: '100%', height: '100%' } }, children);
}

// ===== NODE MANIPULATION FUNCTIONS =====
async function addFirstTrack() {
    console.log('🔵 Adding first track...');
    const newNodeId = `node_${Date.now()}`;
    const newNode = {
        id: newNodeId,
        type: 'trackNode',
        position: { x: 100, y: 100 },
        data: { title: 'New Track', status: 'Not Started', children: [] }
    };
    
    nodes = [newNode];
    edges = [];
    
    if (window.reactFlowInstance) {
        window.reactFlowInstance.setNodes(nodes);
        window.reactFlowInstance.setEdges(edges);
    }
    await saveCurrentStage();
}

async function addSiblingNode(parentNodeId) {
    const newNodeId = `node_${Date.now()}`;
    const parentNode = nodes.find(n => n.id === parentNodeId);
    
    const newNode = {
        id: newNodeId,
        type: 'trackNode',
        position: { x: (parentNode?.position.x || 0) + 350, y: parentNode?.position.y || 100 },
        data: { title: 'New Track', status: 'Not Started', children: [] }
    };
    
    nodes.push(newNode);
    edges.push({ id: `edge_${Date.now()}`, source: parentNodeId, target: newNodeId });
    
    if (window.reactFlowInstance) {
        window.reactFlowInstance.setNodes(nodes);
        window.reactFlowInstance.setEdges(edges);
    }
    await saveCurrentStage();
}

async function addChildNode(parentNodeId) {
    const childNodeId = `node_${Date.now()}`;
    const parentNode = nodes.find(n => n.id === parentNodeId);
    
    const childNode = {
        id: childNodeId,
        type: 'stepNode',
        position: { x: parentNode?.position.x || 0, y: (parentNode?.position.y || 0) + 200 },
        data: { title: 'New Step', resources: [] }
    };
    
    nodes.push(childNode);
    edges.push({ id: `edge_${Date.now()}`, source: parentNodeId, target: childNodeId });
    
    if (window.reactFlowInstance) {
        window.reactFlowInstance.setNodes(nodes);
        window.reactFlowInstance.setEdges(edges);
    }
    await saveCurrentStage();
}

async function addResource(stepNodeId) {
    const resourceTitle = prompt('Enter resource title:');
    if (!resourceTitle) return;
    const resourceUrl = prompt('Enter resource URL:');
    if (!resourceUrl) return;
    
    const stepNode = nodes.find(n => n.id === stepNodeId);
    if (stepNode && stepNode.type === 'stepNode') {
        if (!stepNode.data.resources) stepNode.data.resources = [];
        stepNode.data.resources.push({
            id: `res_${Date.now()}`,
            title: resourceTitle,
            url: resourceUrl
        });
        
        if (window.reactFlowInstance) {
            window.reactFlowInstance.setNodes(nodes);
        }
        await saveCurrentStage();
    }
}

// ===== SIDEBAR FUNCTIONS =====
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const toggleBtn = document.getElementById('sidebarToggle');
    sidebar.classList.toggle('collapsed');
    toggleBtn.textContent = sidebar.classList.contains('collapsed') ? '▶' : '◀';
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
