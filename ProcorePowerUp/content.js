// --- 1. INJECT WIRETAP IMMEDIATELY ---
const script = document.createElement('script');
script.src = chrome.runtime.getURL('injected.js');
script.onload = function() { this.remove(); };
(document.head || document.documentElement).appendChild(script);

// --- GLOBAL VARIABLES ---
let isSidebarOpen = false;
let globalDrawings = []; // Accumulate drawings found
let globalIds = { projectId: '3051002', drawingAreaId: '2532028' }; 

// --- 2. SMART DATA PROCESSOR ---
// recursively search any object for an array that looks like drawings
function findDrawingsInObject(obj) {
    if (!obj) return [];
    
    // If it is an array, check the first item
    if (Array.isArray(obj)) {
        if (obj.length > 0 && (obj[0].number || obj[0].drawing_number || obj[0].title)) {
            return obj; // Found them!
        }
        return [];
    }

    // If it is an object, scan its keys (e.g., data.items or data.drawing_revisions)
    if (typeof obj === 'object') {
        for (let key in obj) {
            if (Array.isArray(obj[key])) {
                const arr = obj[key];
                if (arr.length > 0 && (arr[0].number || arr[0].drawing_number || arr[0].title)) {
                    return arr;
                }
            }
        }
    }
    return [];
}

window.addEventListener("message", (event) => {
    if (event.source !== window) return;

    if (event.data.type === 'PP_DATA') {
        const rawData = event.data.payload;
        if (event.data.ids) globalIds = event.data.ids;

        // Use the "Smart Search" to find drawings inside the packet
        const found = findDrawingsInObject(rawData);

        if (found.length > 0) {
            console.log(`Procore Power-Up: Found ${found.length} drawings in packet!`);
            // Add to our master list (avoid duplicates)
            const newDrawings = found.filter(d => !globalDrawings.some(g => g.id === d.id));
            globalDrawings = [...globalDrawings, ...newDrawings];
            
            const treeRoot = document.getElementById('pp-tree-content');
            if (treeRoot && isSidebarOpen) {
                 buildTree(globalDrawings, globalIds);
            } else if (treeRoot) {
                treeRoot.innerHTML = `<div style="padding:20px; text-align:center; color:green;">
                    <strong>${globalDrawings.length} Drawings Captured!</strong><br>
                    The list is ready.
                </div>`;
            }
        }
    }
});

// --- 3. UI LOGIC ---

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
        <div class="pp-search-box">
            <input type="text" id="pp-search" placeholder="Filter drawings...">
        </div>
        <div id="pp-tree-content" class="pp-content">
            <div class="loading-spinner" style="text-align:center; padding:20px; color:#666;">
                <p>Waiting for data...</p>
                <p style="font-size: 11px;">Please <strong>REFRESH (F5)</strong> the page to start capturing.</p>
            </div>
        </div>
    `;
    document.body.appendChild(sidebar);

    document.getElementById('pp-close').onclick = toggleSidebar;
    document.getElementById('pp-search').addEventListener('keyup', filterTree);
}

function toggleSidebar() {
    const sidebar = document.getElementById('pp-sidebar');
    isSidebarOpen = !isSidebarOpen;
    
    if (isSidebarOpen) {
        sidebar.classList.add('open');
        if (globalDrawings.length > 0) {
            buildTree(globalDrawings, globalIds);
        }
    } else {
        sidebar.classList.remove('open');
    }
}

// --- TREE BUILDER ---
function buildTree(drawings, ids) {
    const treeRoot = document.getElementById('pp-tree-content');
    treeRoot.innerHTML = ''; 

    const groups = {};

    drawings.forEach(dwg => {
        // Handle different field names (number vs drawing_number)
        const num = dwg.number || dwg.drawing_number || "???";
        const title = dwg.title || "No Title";
        
        // Normalize object for display
        dwg.displayNumber = num;
        dwg.displayTitle = title;

        let disc = dwg.discipline || "General";
        if ((!dwg.discipline) && num) {
            const firstChar = num.charAt(0).toUpperCase();
            const map = {'A': 'Architectural', 'S': 'Structural', 'M': 'Mechanical', 'E': 'Electrical', 'P': 'Plumbing', 'C': 'Civil', 'L': 'Landscape', 'I': 'Interiors'};
            if(map[firstChar]) disc = map[firstChar];
        }
        if (!groups[disc]) groups[disc] = [];
        groups[disc].push(dwg);
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
        
        // Unit Plans Subfolder
        const unitPlans = [];
        const otherPlans = [];

        groups[discipline].forEach(d => {
            if (d.displayTitle && d.displayTitle.toUpperCase().includes("UNIT PLAN")) {
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
    
    // Rev check (handle both field names)
    const rev = dwg.revision_number || dwg.current_revision_id; 
    if (rev && parseInt(rev) > 5) {
        tags += `<span class="tag warning">Rev ${rev}</span>`;
    }
    
    // ID check
    const id = dwg.id || dwg.drawing_id;
    const pid = ids?.projectId || '3051002';
    const aid = ids?.drawingAreaId || '2532028';

    const linkUrl = `https://app.procore.com/${pid}/project/drawing_areas/${aid}/drawing_log/view_fullscreen/${id}`;

    li.innerHTML = `
        <a href="${linkUrl}" target="_blank" class="drawing-link">
            <span class="d-num">${dwg.displayNumber}</span>
            <span class="d-title">${dwg.displayTitle}</span>
            ${tags}
        </a>
    `;
    return li;
}

function sortDrawings(a, b) {
    return a.displayNumber.localeCompare(b.displayNumber, undefined, { numeric: true, sensitivity: 'base' });
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