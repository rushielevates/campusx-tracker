// public/js/journey.js
// React Flow Journey Planner - Complete Implementation

// Global variables
let currentJourney = null;
let activeStageId = null;
let nodes = [];
let edges = [];

// Initialize React app when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    initJourneyPlanner();
});

async function initJourneyPlanner() {
    console.log('🚀 Initializing Journey Planner...');
    
    // Load journey data from backend
    await loadJourneyData();
    
    // Setup stage tabs
    await setupStageTabs();
    
    // Initialize React Flow
    initReactFlow();
}

// Load journey data from server
async function loadJourneyData() {
    try {
        const response = await fetch('/api/journey', {
            credentials: 'include'
        });
        
        if (!response.ok) {
            throw new Error('Failed to load journey');
        }
        
        currentJourney = await response.json();
        activeStageId = currentJourney.activeStageId || currentJourney.stages[0]?.id;
        
        console.log('Journey loaded:', currentJourney);
        
        // Load nodes and edges for active stage
        const activeStage = currentJourney.stages.find(s => s.id === activeStageId);
        if (activeStage) {
            nodes = activeStage.nodes || [];
            edges = activeStage.edges || [];
        }
        
    } catch (error) {
        console.error('Error loading journey:', error);
        // Create default journey if none exists
        await createDefaultJourney();
    }
}

// Create default journey structure
async function createDefaultJourney() {
    console.log('Creating default journey...');
    
    const defaultStages = [
        {
            id: `stage_${Date.now()}`,
            name: 'Stage I: Foundation',
            order: 1,
            nodes: [
                {
                    id: 'node_ml_1',
                    type: 'trackNode',
                    position: { x: 100, y: 100 },
                    data: {
                        title: 'MACHINE LEARNING (ML)',
                        status: 'In Progress',
                        children: []
                    }
                },
                {
                    id: 'node_sql_1',
                    type: 'trackNode',
                    position: { x: 450, y: 100 },
                    data: {
                        title: 'STRUCTURED QUERY LANGUAGE (SQL)',
                        status: 'Not Started',
                        children: []
                    }
                },
                {
                    id: 'node_da_1',
                    type: 'trackNode',
                    position: { x: 800, y: 100 },
                    data: {
                        title: 'DATA ANALYSIS',
                        status: 'Not Started',
                        children: []
                    }
                }
            ],
            edges: []
        }
    ];
    
    try {
        const response = await fetch('/api/journey', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                stages: defaultStages,
                activeStageId: defaultStages[0].id
            })
        });
        
        if (response.ok) {
            currentJourney = await response.json();
            activeStageId = currentJourney.activeStageId;
            const activeStage = currentJourney.stages.find(s => s.id === activeStageId);
            if (activeStage) {
                nodes = activeStage.nodes || [];
                edges = activeStage.edges || [];
            }
        }
    } catch (error) {
        console.error('Error creating default journey:', error);
    }
}

// Setup stage tabs
async function setupStageTabs() {
    const stageTabsContainer = document.getElementById('stageTabs');
    if (!stageTabsContainer) return;
    
    stageTabsContainer.innerHTML = '';
    
    if (!currentJourney || !currentJourney.stages) return;
    
    // Sort stages by order
    const sortedStages = [...currentJourney.stages].sort((a, b) => a.order - b.order);
    
    sortedStages.forEach(stage => {
        const tab = document.createElement('button');
        tab.className = `stage-tab ${activeStageId === stage.id ? 'active' : ''}`;
        tab.textContent = stage.name;
        tab.onclick = () => switchStage(stage.id);
        stageTabsContainer.appendChild(tab);
    });
}

// Switch between stages
async function switchStage(stageId) {
    console.log('Switching to stage:', stageId);
    
    // Save current stage data before switching
    await saveCurrentStage();
    
    activeStageId = stageId;
    
    // Load new stage data
    const stage = currentJourney.stages.find(s => s.id === stageId);
    if (stage) {
        nodes = stage.nodes || [];
        edges = stage.edges || [];
        
        // Update React Flow
        if (window.reactFlowInstance) {
            window.reactFlowInstance.setNodes(nodes);
            window.reactFlowInstance.setEdges(edges);
        }
        
        // Update UI
        updateStageTabs();
    }
    
    // Update active stage in backend
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

// Update stage tabs UI
function updateStageTabs() {
    const tabs = document.querySelectorAll('.stage-tab');
    tabs.forEach(tab => {
        const stage = currentJourney.stages.find(s => s.name === tab.textContent);
        if (stage) {
            tab.classList.toggle('active', stage.id === activeStageId);
        }
    });
}

// Save current stage data
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
            body: JSON.stringify({
                stages: currentJourney.stages,
                activeStageId: activeStageId
            })
        });
    }
}

// Add new stage
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
            switchStage(newStage.id);
        }
    } catch (error) {
        console.error('Error adding stage:', error);
    }
}

// Initialize React Flow
function initReactFlow() {
    // Wait for React to load
    if (typeof React === 'undefined' || typeof ReactDOM === 'undefined') {
        setTimeout(initReactFlow, 100);
        return;
    }
    
    const container = document.getElementById('journey-canvas');
    if (!container) return;
    
    // Define custom node components
    const TrackNode = ({ data, id }) => {
        return React.createElement('div', {
            className: 'track-node',
            style: { background: '#2d2d44', borderRadius: '12px', padding: '16px', width: '220px', border: '1px solid #4a4a6a' }
        },
            React.createElement('div', { className: 'track-node-title', style: { color: 'white', fontWeight: 'bold', marginBottom: '8px' } }, data.title),
            React.createElement('div', { className: 'track-node-status', style: { color: '#a0a0c0', fontSize: '12px', marginBottom: '12px' } }, data.status || 'Not Started'),
            React.createElement('div', { className: 'node-buttons', style: { display: 'flex', gap: '8px', marginTop: '8px' } },
                React.createElement('button', {
                    className: 'add-horizontal-btn',
                    onClick: () => addSiblingNode(id),
                    style: { background: 'rgba(255,255,255,0.1)', border: 'none', color: 'white', padding: '4px 8px', borderRadius: '4px', fontSize: '11px', cursor: 'pointer' }
                }, '➕ Parallel'),
                React.createElement('button', {
                    className: 'add-vertical-btn',
                    onClick: () => addChildNode(id),
                    style: { background: 'rgba(255,255,255,0.1)', border: 'none', color: 'white', padding: '4px 8px', borderRadius: '4px', fontSize: '11px', cursor: 'pointer' }
                }, '➕ Step')
            ),
            data.children?.map(child => renderChildNode(child))
        );
    };
    
    const StepNode = ({ data, id }) => {
        return React.createElement('div', {
            className: 'step-node',
            style: { background: '#1e1e2e', borderRadius: '10px', padding: '12px', width: '200px', border: '1px solid #3a3a5a' }
        },
            React.createElement('div', { className: 'step-node-title', style: { color: 'white', fontWeight: '500', marginBottom: '8px' } }, data.title),
            data.url && React.createElement('a', {
                href: data.url,
                target: '_blank',
                className: 'step-node-url',
                style: { color: '#60a5fa', fontSize: '11px', textDecoration: 'none', display: 'block', wordBreak: 'break-all', marginBottom: '8px' }
            }, '🔗 ' + data.url.substring(0, 30) + '...'),
            data.progress && React.createElement('div', { style: { color: '#a0a0c0', fontSize: '11px', marginBottom: '8px' } }, data.progress),
            React.createElement('div', { className: 'resource-cards', style: { display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' } },
                data.resources?.map(res => renderResourceCard(res))
            ),
            React.createElement('button', {
                className: 'add-resource-btn',
                onClick: () => addResource(id),
                style: { background: 'none', border: '1px dashed #5a5a7a', color: '#a0a0c0', fontSize: '10px', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer', marginTop: '8px', width: '100%' }
            }, '+ Add Resource')
        );
    };
    
    const renderChildNode = (child) => {
        return React.createElement(StepNode, { key: child.id, data: child.data, id: child.id });
    };
    
    const renderResourceCard = (resource) => {
        return React.createElement('div', {
            key: resource.id,
            className: 'resource-card',
            style: { position: 'relative', display: 'inline-block' }
        },
            React.createElement('a', {
                href: resource.url,
                target: '_blank',
                className: 'resource-card-link',
                style: { background: '#2d2d44', color: 'white', fontSize: '10px', padding: '4px 8px', borderRadius: '4px', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px' }
            }, '📎 ' + resource.title.substring(0, 3)),
            React.createElement('div', {
                className: 'resource-tooltip',
                style: { position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)', background: '#1a1a2e', color: 'white', padding: '4px 8px', borderRadius: '4px', fontSize: '10px', whiteSpace: 'nowrap', zIndex: 100, display: 'none', marginBottom: '5px' }
            }, resource.title)
        );
    };
    
    // Create React root
    const root = ReactDOM.createRoot(container);
    
    // Initial render
    root.render(React.createElement(ReactFlowProvider, null,
        React.createElement(ReactFlowComponent, {
            nodes: nodes,
            edges: edges,
            onNodesChange: handleNodesChange,
            onEdgesChange: handleEdgesChange,
            onConnect: handleConnect
        })
    ));
}

// React Flow Component
function ReactFlowComponent({ nodes: initialNodes, edges: initialEdges, onNodesChange, onEdgesChange, onConnect }) {
    const [rfNodes, setRfNodes] = React.useState(initialNodes);
    const [rfEdges, setRfEdges] = React.useState(initialEdges);
    
    React.useEffect(() => {
        setRfNodes(initialNodes);
        setRfEdges(initialEdges);
    }, [initialNodes, initialEdges]);
    
    const onNodesChangeHandler = (changes) => {
        const updatedNodes = applyNodeChanges(changes, rfNodes);
        setRfNodes(updatedNodes);
        nodes = updatedNodes;
        onNodesChange?.(changes);
    };
    
    const onEdgesChangeHandler = (changes) => {
        const updatedEdges = applyEdgeChanges(changes, rfEdges);
        setRfEdges(updatedEdges);
        edges = updatedEdges;
        onEdgesChange?.(changes);
    };
    
    const onConnectHandler = (connection) => {
        const newEdge = { ...connection, id: `edge_${Date.now()}` };
        const updatedEdges = [...rfEdges, newEdge];
        setRfEdges(updatedEdges);
        edges = updatedEdges;
        onConnect?.(connection);
    };
    
    return React.createElement(ReactFlow, {
        nodes: rfNodes,
        edges: rfEdges,
        onNodesChange: onNodesChangeHandler,
        onEdgesChange: onEdgesChangeHandler,
        onConnect: onConnectHandler,
        nodeTypes: { trackNode: TrackNode, stepNode: StepNode },
        fitView: true,
        minZoom: 0.5,
        maxZoom: 2,
        defaultViewport: { x: 0, y: 0, zoom: 1 }
    });
}

// Helper functions for node/edge changes
function applyNodeChanges(changes, nodes) {
    let updatedNodes = [...nodes];
    changes.forEach(change => {
        if (change.type === 'position') {
            const index = updatedNodes.findIndex(n => n.id === change.id);
            if (index !== -1) {
                updatedNodes[index] = { ...updatedNodes[index], position: change.position };
            }
        }
    });
    return updatedNodes;
}

function applyEdgeChanges(changes, edges) {
    let updatedEdges = [...edges];
    changes.forEach(change => {
        if (change.type === 'remove') {
            updatedEdges = updatedEdges.filter(e => e.id !== change.id);
        }
    });
    return updatedEdges;
}

function handleNodesChange(changes) {
    console.log('Nodes changed:', changes);
}

function handleEdgesChange(changes) {
    console.log('Edges changed:', changes);
}

function handleConnect(connection) {
    console.log('Connected:', connection);
}

// Add sibling node (horizontal - parallel track)
async function addSiblingNode(parentNodeId) {
    const newNodeId = `node_${Date.now()}`;
    const parentNode = nodes.find(n => n.id === parentNodeId);
    
    const newNode = {
        id: newNodeId,
        type: 'trackNode',
        position: { x: (parentNode?.position.x || 0) + 350, y: parentNode?.position.y || 100 },
        data: {
            title: 'New Track',
            status: 'Not Started',
            children: []
        }
    };
    
    nodes.push(newNode);
    
    // Add edge between parent and sibling
    const newEdge = {
        id: `edge_${Date.now()}`,
        source: parentNodeId,
        target: newNodeId,
        type: 'smoothstep'
    };
    edges.push(newEdge);
    
    // Update React Flow
    if (window.reactFlowInstance) {
        window.reactFlowInstance.setNodes(nodes);
        window.reactFlowInstance.setEdges(edges);
    }
    
    await saveCurrentStage();
}

// Add child node (vertical - step)
async function addChildNode(parentNodeId) {
    const childNodeId = `node_${Date.now()}`;
    const parentNode = nodes.find(n => n.id === parentNodeId);
    
    const childNode = {
        id: childNodeId,
        type: 'stepNode',
        position: { x: parentNode?.position.x || 0, y: (parentNode?.position.y || 0) + 200 },
        data: {
            title: 'New Step',
            resources: []
        }
    };
    
    nodes.push(childNode);
    
    // Add edge between parent and child
    const newEdge = {
        id: `edge_${Date.now()}`,
        source: parentNodeId,
        target: childNodeId,
        type: 'smoothstep'
    };
    edges.push(newEdge);
    
    // Update React Flow
    if (window.reactFlowInstance) {
        window.reactFlowInstance.setNodes(nodes);
        window.reactFlowInstance.setEdges(edges);
    }
    
    await saveCurrentStage();
}

// Add resource to step node
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
        
        // Update React Flow
        if (window.reactFlowInstance) {
            window.reactFlowInstance.setNodes(nodes);
        }
        
        await saveCurrentStage();
    }
}

// React Flow Provider component (simplified)
function ReactFlowProvider({ children }) {
    return React.createElement('div', { style: { width: '100%', height: '100%' } }, children);
}

// React Flow component wrapper
function ReactFlow({ nodes, edges, onNodesChange, onEdgesChange, onConnect, nodeTypes, fitView, minZoom, maxZoom, defaultViewport }) {
    const containerRef = React.useRef(null);
    
    React.useEffect(() => {
        if (containerRef.current && window.reactFlowInstance) {
            window.reactFlowInstance.setNodes(nodes);
            window.reactFlowInstance.setEdges(edges);
        }
    }, [nodes, edges]);
    
    // Store instance reference
    window.reactFlowInstance = {
        setNodes: (newNodes) => { nodes = newNodes; },
        setEdges: (newEdges) => { edges = newEdges; }
    };
    
    return React.createElement('div', {
        ref: containerRef,
        style: { width: '100%', height: '100%', background: '#1a1a2e', position: 'relative' }
    },
        React.createElement('div', { style: { position: 'absolute', top: '10px', left: '10px', zIndex: 10, color: '#a0a0c0', fontSize: '12px' } },
            '💡 Tip: Click +Parallel to add new tracks, +Step to add subtasks'
        ),
        React.createElement('div', { style: { padding: '20px' } },
            nodes.map(node => {
                if (node.type === 'trackNode') {
                    return React.createElement(TrackNodeComponent, { key: node.id, data: node.data, id: node.id });
                } else if (node.type === 'stepNode') {
                    return React.createElement(StepNodeComponent, { key: node.id, data: node.data, id: node.id });
                }
                return null;
            })
        )
    );
}

// Simple node components (non-interactive for now)
function TrackNodeComponent({ data, id }) {
    return React.createElement('div', {
        style: { position: 'absolute', left: data.position?.x || 100, top: data.position?.y || 100, background: '#2d2d44', borderRadius: '12px', padding: '16px', width: '220px', border: '1px solid #4a4a6a', boxShadow: '0 4px 6px rgba(0,0,0,0.3)' }
    },
        React.createElement('div', { style: { color: 'white', fontWeight: 'bold', marginBottom: '8px' } }, data.title),
        React.createElement('div', { style: { color: '#a0a0c0', fontSize: '12px', marginBottom: '12px' } }, data.status || 'Not Started'),
        React.createElement('div', { style: { display: 'flex', gap: '8px' } },
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
}

function StepNodeComponent({ data, id }) {
    return React.createElement('div', {
        style: { position: 'absolute', left: data.position?.x || 100, top: data.position?.y || 300, background: '#1e1e2e', borderRadius: '10px', padding: '12px', width: '200px', border: '1px solid #3a3a5a' }
    },
        React.createElement('div', { style: { color: 'white', fontWeight: '500', marginBottom: '8px' } }, data.title),
        data.url && React.createElement('a', {
            href: data.url,
            target: '_blank',
            style: { color: '#60a5fa', fontSize: '11px', textDecoration: 'none', display: 'block', marginBottom: '8px' }
        }, '🔗 Link'),
        data.progress && React.createElement('div', { style: { color: '#a0a0c0', fontSize: '11px', marginBottom: '8px' } }, data.progress),
        React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' } },
            data.resources?.map(res => renderResourceCardComponent(res))
        ),
        React.createElement('button', {
            onClick: () => addResource(id),
            style: { background: 'none', border: '1px dashed #5a5a7a', color: '#a0a0c0', fontSize: '10px', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer', marginTop: '8px', width: '100%' }
        }, '+ Add Resource')
    );
}

function renderResourceCardComponent(resource) {
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
}

// Sidebar toggle function
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const toggleBtn = document.getElementById('sidebarToggle');
    
    sidebar.classList.toggle('collapsed');
    
    if (sidebar.classList.contains('collapsed')) {
        toggleBtn.textContent = '▶';
        localStorage.setItem('sidebarCollapsed', 'true');
    } else {
        toggleBtn.textContent = '◀';
        localStorage.setItem('sidebarCollapsed', 'false');
    }
}

// Load saved sidebar state
if (localStorage.getItem('sidebarCollapsed') === 'true') {
    const sidebar = document.getElementById('sidebar');
    const toggleBtn = document.getElementById('sidebarToggle');
    if (sidebar) {
        sidebar.classList.add('collapsed');
        if (toggleBtn) toggleBtn.textContent = '▶';
    }
}

// Logout function
async function logout() {
    await fetch('/api/auth/logout', { credentials: 'include' });
    window.location.href = '/';
}
