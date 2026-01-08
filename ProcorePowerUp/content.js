// --- 1. INJECT WIRETAP ---
const script = document.createElement('script');
script.src = chrome.runtime.getURL('injected.js');
script.onload = function() { this.remove(); };
(document.head || document.documentElement).appendChild(script);

// --- GLOBAL VARIABLES ---
let isSidebarOpen = false;
let globalDrawings = []; 
let globalIds = { projectId: '3051002', drawingAreaId: '2532028' }; 

// --- 2. LISTEN FOR DATA ---
window.addEventListener("message", (event) => {
    if (event.source !== window) return;

    if (event.data.type === 'PP_DATA') {
        const rawData = event.data.payload;
        if (event.data.ids && event.data.ids.projectId) globalIds = event.data.ids;

        const found = findDrawingsInObject(rawData);

        if (found.length > 0) {
            console.log(`Procore Power-Up: Captured ${found.length} drawings.`);
            
            // Merge with existing list (avoid duplicates)
            const existingIds = new Set(globalDrawings.map(d => d.id));
            const newItems = found.filter(d => !existingIds.has(d.id));
            globalDrawings = [...globalDrawings, ...newItems];

            updateSidebarUI();
        }
    }
});

function findDrawingsInObject(obj) {
    if (!obj) return [];
    if (Array.isArray(obj)) return checkArray(obj);
    for (let key in obj) {
        if (Array.isArray(obj[key])) {
            const result = checkArray(obj[key]);
            if (result.length > 0) return result;
        }
    }
    return [];
}

function checkArray(arr) {
    if (arr.length === 0) return [];
    const item = arr[0];
    if (item.number || item.drawing_number || item.title || (item.id && item.discipline)) {
        return arr;
    }
    return [];
}

// --- 3. UI INITIALIZATION ---
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUI);
} else {
    initUI();
}

function initUI() {
    if (document.getElementById('pp-toggle-btn')) return;

    const toggleBtn = document.createElement('div');
    toggleBtn.id = 'pp-toggle-btn';
    toggleBtn.innerHTML = '📂'; 
    toggleBtn.title = "Open Drawing Tree";
    toggleBtn.onclick = toggleSidebar;
    document.body.appendChild(toggleBtn);

    const sidebar = document.createElement('div');
    sidebar.id = 'pp-sidebar';
    sidebar.innerHTML = `
        <div class="pp-header">
            <h3>Project Drawings</h3>
            <span class="close-btn" id="pp-close">&times;</span>
        </div>
        
        <div class="pp-controls">
            <button id="pp-load-all" class="pp-btn-primary">🔄 Load All Data</button>
        </div>

        <div class="pp-search-box">
            <input type="text" id="pp-search" placeholder="Filter drawings...">
        </div>
        
        <div id="pp-tree-content" class="pp-content">
            <div class="empty-state">
                <p><strong>Waiting for data...</strong></p>
                <p>Click the <strong>"Load All Data"</strong> button above to expand the list.</p>
            </div>
        </div>
    `;
    document.body.appendChild(sidebar);

    document.getElementById('pp-close').onclick = toggleSidebar;
    document.getElementById('pp-search').addEventListener('keyup', filterTree);
    document.getElementById('pp-load-all').addEventListener('click', expandAllGroups);
}

// --- 4. THE "LOAD ALL" FUNCTION (UPDATED) ---
function expandAllGroups() {
    const btn = document.getElementById('pp-load-all');
    btn.innerText = "Expanding...";
    btn.disabled = true;

    // TARGET: The specific "Expand/Collapse All" button from Procore's UI
    // We use the class 'expand-button' which matches the code you provided.
    const expandAllBtn = document.querySelector('.expand-button');

    if (!expandAllBtn) {
         // Fallback if the UI changed, but usually this is stable
         alert("Could not find the 'Expand All' button on the page. Please click the small caret icon in the table header manually.");
         btn.innerText = "🔄 Load All Data";
         btn.disabled = false;
         return;
    }

    console.log("Procore Power-Up: Clicking 'Expand All' button...");
    
    // Click the main toggle
    expandAllBtn.click();

    // OPTIONAL: Double-check logic
    // If the button was in "Collapse" mode (meaning everything closes), we might need to click it again.
    // For now, a single click usually toggles state. If you see it close everything, just click it again manually.
    
    // Reset button after a delay to allow data to load
    setTimeout(() => {
        btn.innerText = "Done!";
        setTimeout(() => { 
            btn.innerText = "🔄 Load All Data"; 
            btn.disabled = false; 
        }, 2000);
    }, 1000);
}

function updateSidebarUI() {
    const treeRoot = document.getElementById('pp-tree-content');
    if (globalDrawings.length > 0 && isSidebarOpen) {
        buildTree(globalDrawings, globalIds);
    }
}

function toggleSidebar() {
    const sidebar = document.getElementById('pp-sidebar');
    isSidebarOpen = !isSidebarOpen;
    if (isSidebarOpen) {
        sidebar.classList.add('open');
        updateSidebarUI();
    } else {
        sidebar.classList.remove('open');
    }
}

// --- TREE BUILDING LOGIC ---
function buildTree(drawings, ids) {
    const treeRoot = document.getElementById('pp-tree-content');
    treeRoot.innerHTML = ''; 

    const validDrawings = drawings.filter(d => d.number || d.drawing_number);
    if (validDrawings.length === 0) return;

    const groups = {};

    validDrawings.forEach(dwg => {
        const num = dwg.number || dwg.drawing_number;
        const title = dwg.title || "No Title";
        const id = dwg.id;
        
        let disc = dwg.discipline || "General";
        if ((!dwg.discipline) && num) {
            const firstChar = num.charAt(0).toUpperCase();
            const map = {'A': 'Architectural', 'S': 'Structural', 'M': 'Mechanical', 'E': 'Electrical', 'P': 'Plumbing', 'C': 'Civil', 'L': 'Landscape', 'I': 'Interiors'};
            if(map[firstChar]) disc = map[firstChar];
        }
        if (!groups[disc]) groups[disc] = [];
        
        groups[disc].push({ num, title, id, raw: dwg });
    });

    Object.keys(groups).sort().forEach(discipline => {
        const discContainer = document.createElement('details');
        discContainer.open = false; 
        discContainer.className = 'tree-discipline';
        
        const colorClass = getDisciplineColor(discipline);
        const summary = document.createElement('summary');
        summary.innerHTML = `<span class="disc-tag ${colorClass}">${discipline.charAt(0)}</span> ${discipline} (${groups[discipline].length})`;
        discContainer.appendChild(summary);

        const list = document.createElement('ul');
        
        const unitPlans = [];
        const otherPlans = [];

        groups[discipline].forEach(d => {
            if (d.title && d.title.toUpperCase().includes("UNIT PLAN")) {
                unitPlans.push(d);
            } else {
                otherPlans.push(d);
            }
        });

        if (unitPlans.length > 0) {
            const subFolder = document.createElement('details');
            subFolder.className = 'tree-subfolder';
            subFolder.innerHTML = `<summary>📂 Unit Plans (${unitPlans.length})</summary>`;
            const subList = document.createElement('ul');
            unitPlans.sort(sortDrawings).forEach(d => subList.appendChild(createDrawingRow(d, ids)));
            subFolder.appendChild(subList);
            list.appendChild(subFolder);
        }

        otherPlans.sort(sortDrawings).forEach(dwg => list.appendChild(createDrawingRow(dwg, ids)));

        discContainer.appendChild(list);
        treeRoot.appendChild(discContainer);
    });
}

function createDrawingRow(dwg, ids) {
    const li = document.createElement('li');
    li.className = 'drawing-row';
    
    let tags = '';
    const rev = dwg.raw?.revision_number || dwg.raw?.current_revision_id;
    if (rev && parseInt(rev) > 5) {
        tags += `<span class="tag warning">Rev ${rev}</span>`;
    }

    const pid = ids?.projectId || '3051002';
    const aid = ids?.drawingAreaId || '2532028';
    const linkUrl = `https://app.procore.com/${pid}/project/drawing_areas/${aid}/drawing_log/view_fullscreen/${dwg.id}`;

    li.innerHTML = `
        <a href="${linkUrl}" target="_blank" class="drawing-link">
            <span class="d-num">${dwg.num}</span>
            <span class="d-title">${dwg.title}</span>
            ${tags}
        </a>
    `;
    return li;
}

function sortDrawings(a, b) {
    return a.num.localeCompare(b.num, undefined, { numeric: true, sensitivity: 'base' });
}

function getDisciplineColor(name) {
    if (!name) return 'c-gray';
    const n = name.toUpperCase();
    if (n.startsWith('ARCH') || n === 'A') return 'c-red';       
    if (n.startsWith('STR') || n === 'S') return 'c-blue';      
    if (n.startsWith('MECH') || n === 'M') return 'c-green';     
    if (n.startsWith('ELEC') || n === 'E') return 'c-yellow';    
    if (n.startsWith('PLUM') || n === 'P') return 'c-cyan';      
    if (n.startsWith('CIV') || n === 'C') return 'c-brown';     
    return 'c-gray';
}

function filterTree() {
    const term = document.getElementById('pp-search').value.toLowerCase();
    const rows = document.querySelectorAll('.drawing-row');
    rows.forEach(row => {
        const text = row.innerText.toLowerCase();
        if (text.includes(term)) {
            row.style.display = 'block';
            let parent = row.parentElement.parentElement; 
            if(parent.tagName === 'DETAILS') parent.open = true;
            if(parent.parentElement.parentElement.tagName === 'DETAILS') parent.parentElement.parentElement.open = true;
        } else {
            row.style.display = 'none';
        }
    });
}