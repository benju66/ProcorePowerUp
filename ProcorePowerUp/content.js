// content.js - Phase 1: Architecture & Persistence

// --- 1. INJECT WIRETAP ---
// We inject the script to intercept Procore's network traffic
const script = document.createElement('script');
script.src = chrome.runtime.getURL('injected.js');
script.onload = function() { this.remove(); };
(document.head || document.documentElement).appendChild(script);

// ==========================================
// MODULE: STORE (Persistence Layer)
// ==========================================
const PP_Store = {
    // Save project data to Chrome Local Storage
    async saveProjectData(projectId, drawings, companyId, areaId) {
        if (!projectId) return;
        
        const timestamp = Date.now();
        const key = `pp_cache_${projectId}`;
        
        // Sanitize: Only save what we need to save space
        const sanitizedDrawings = drawings.map(d => ({
            id: d.id,
            number: d.number || d.drawing_number,
            title: d.title,
            discipline: d.discipline,
            revision: d.revision_number || d.current_revision_id
        }));

        const payload = {
            timestamp,
            companyId,
            drawingAreaId: areaId,
            drawings: sanitizedDrawings
        };

        return new Promise((resolve) => {
            chrome.storage.local.set({ [key]: payload }, () => {
                console.log(`Procore Power-Up: Saved ${sanitizedDrawings.length} drawings for Project ${projectId}`);
                resolve(payload);
            });
        });
    },

    // Retrieve data for a specific project
    async getProjectData(projectId) {
        if (!projectId) return null;
        const key = `pp_cache_${projectId}`;
        return new Promise((resolve) => {
            chrome.storage.local.get([key], (result) => {
                resolve(result[key] || null);
            });
        });
    }
};

// ==========================================
// MODULE: UI (Rendering Layer)
// ==========================================
const PP_UI = {
    isOpen: false,

    init() {
        if (document.getElementById('pp-toggle-btn')) return;

        // Toggle Button
        const toggleBtn = document.createElement('div');
        toggleBtn.id = 'pp-toggle-btn';
        toggleBtn.innerHTML = '📂'; 
        toggleBtn.title = "Open Drawing Tree";
        toggleBtn.onclick = () => PP_Core.toggleSidebar();
        document.body.appendChild(toggleBtn);

        // Sidebar Container
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
                </div>

            <div class="pp-footer" id="pp-footer">
                </div>
        `;
        document.body.appendChild(sidebar);

        // Event Listeners
        document.getElementById('pp-close').onclick = () => PP_Core.toggleSidebar();
        document.getElementById('pp-search').addEventListener('keyup', PP_UI.filterTree);
        document.getElementById('pp-load-all').addEventListener('click', PP_Core.triggerLoadAll);
    },

    toggle(openState) {
        this.isOpen = openState;
        const sidebar = document.getElementById('pp-sidebar');
        if (openState) sidebar.classList.add('open');
        else sidebar.classList.remove('open');
    },

    renderState(stateType, data = null) {
        const treeRoot = document.getElementById('pp-tree-content');
        const footer = document.getElementById('pp-footer');
        const loadBtn = document.getElementById('pp-load-all');

        if (stateType === 'LOADING') {
            treeRoot.innerHTML = `<div class="empty-state"><p>Loading...</p></div>`;
        } 
        else if (stateType === 'WRONG_PROJECT') {
            treeRoot.innerHTML = `
                <div class="empty-state warning">
                    <p><strong>New Project Detected</strong></p>
                    <p>The sidebar has data for a different project.</p>
                    <p>Please navigate to the <strong>Drawings Tool</strong> and click "Load All Data" to capture this project.</p>
                </div>`;
            footer.innerText = "";
            loadBtn.disabled = true;
        }
        else if (stateType === 'EMPTY') {
            treeRoot.innerHTML = `
                <div class="empty-state">
                    <p><strong>No drawings found.</strong></p>
                    <p>Click "Load All Data" above to fetch the drawing list.</p>
                </div>`;
            footer.innerText = "";
            loadBtn.disabled = false;
        } 
        else if (stateType === 'DATA') {
            PP_UI.buildTree(data.drawings, data.projectId, data.drawingAreaId);
            const dateStr = new Date(data.timestamp).toLocaleString();
            footer.innerText = `Last updated: ${dateStr}`;
            loadBtn.disabled = false;
        }
    },

    // --- UPDATED TREE LOGIC ---
    buildTree(drawings, projectId, areaId) {
        const treeRoot = document.getElementById('pp-tree-content');
        treeRoot.innerHTML = ''; 

        // FEATURE FLAG: Set to true to enable custom folders like "Unit Plans"
        const SHOW_CUSTOM_FOLDERS = false; 

        const validDrawings = drawings.filter(d => d.number || d.drawing_number);
        if (validDrawings.length === 0) {
            treeRoot.innerHTML = '<div class="empty-state"><p>No valid drawings found.</p></div>';
            return;
        }

        const groups = {};

        // 1. Grouping Logic (Updated for better detection)
        validDrawings.forEach(dwg => {
            const num = dwg.number || dwg.drawing_number;
            const title = dwg.title || "No Title";
            const id = dwg.id;
            
            // Try to find the discipline name from various possible fields
            let disc = dwg.discipline || dwg.discipline_name || "General";
            
            // If we have a "Drawing Set", prepend it (e.g., "Renovation Set - Architectural")
            if (dwg.drawing_set || dwg.drawing_set_title) {
                const set = dwg.drawing_set || dwg.drawing_set_title;
                // Avoid redundant "Current Set - Architectural", usually we just want specific sets
                if (!set.toLowerCase().includes('current')) {
                     disc = `${set} - ${disc}`;
                }
            }

            // Fallback: If still "General" and we have a number, try the letter mapping
            if (disc === "General" && num) {
                const firstChar = num.charAt(0).toUpperCase();
                const map = {'A': 'Architectural', 'S': 'Structural', 'M': 'Mechanical', 'E': 'Electrical', 'P': 'Plumbing', 'C': 'Civil', 'L': 'Landscape', 'I': 'Interiors'};
                if(map[firstChar]) disc = map[firstChar];
            }

            if (!groups[disc]) groups[disc] = [];
            groups[disc].push({ num, title, id, raw: dwg });
        });

        // 2. Rendering DOM
        Object.keys(groups).sort().forEach(discipline => {
            const discContainer = document.createElement('details');
            discContainer.open = false; 
            discContainer.className = 'tree-discipline';
            
            const colorClass = PP_UI.getDisciplineColor(discipline);
            
            // Clean up the name for display (remove "Set" if it gets too long)
            const displayName = discipline; 

            const summary = document.createElement('summary');
            summary.innerHTML = `<span class="disc-tag ${colorClass}">${discipline.charAt(0)}</span> ${displayName} (${groups[discipline].length})`;
            discContainer.appendChild(summary);

            const list = document.createElement('ul');
            
            // Split logic for "Unit Plans" (Controlled by Feature Flag)
            let drawingsToRender = groups[discipline];

            if (SHOW_CUSTOM_FOLDERS) {
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
                    unitPlans.sort(PP_UI.sortDrawings).forEach(d => subList.appendChild(PP_UI.createDrawingRow(d, projectId, areaId)));
                    subFolder.appendChild(subList);
                    list.appendChild(subFolder);
                }
                drawingsToRender = otherPlans;
            }

            // Render remaining drawings
            drawingsToRender.sort(PP_UI.sortDrawings).forEach(dwg => list.appendChild(PP_UI.createDrawingRow(dwg, projectId, areaId)));

            discContainer.appendChild(list);
            treeRoot.appendChild(discContainer);
        });
    },

    createDrawingRow(dwg, projectId, areaId) {
        const li = document.createElement('li');
        li.className = 'drawing-row';
        
        let tags = '';
        const rev = dwg.raw?.revision_number || dwg.raw?.current_revision_id || dwg.raw?.revision;
        if (rev && parseInt(rev) > 5) {
            tags += `<span class="tag warning">Rev ${rev}</span>`;
        }

        // Fallback IDs if something is missing
        const pid = projectId || '3051002';
        const aid = areaId || '2532028'; 
        const linkUrl = `https://app.procore.com/${pid}/project/drawing_areas/${aid}/drawing_log/view_fullscreen/${dwg.id}`;

        li.innerHTML = `
            <a href="${linkUrl}" target="_blank" class="drawing-link">
                <span class="d-num">${dwg.num}</span>
                <span class="d-title">${dwg.title}</span>
                ${tags}
            </a>
        `;
        return li;
    },

    sortDrawings(a, b) {
        return a.num.localeCompare(b.num, undefined, { numeric: true, sensitivity: 'base' });
    },

    getDisciplineColor(name) {
        if (!name) return 'c-gray';
        const n = name.toUpperCase();
        if (n.includes('ARCH') || n.startsWith('A')) return 'c-red';       
        if (n.includes('STR') || n.startsWith('S')) return 'c-blue';      
        if (n.includes('MECH') || n.startsWith('M')) return 'c-green';     
        if (n.includes('ELEC') || n.startsWith('E')) return 'c-yellow';    
        if (n.includes('PLUM') || n.startsWith('P')) return 'c-cyan';      
        if (n.includes('CIV') || n.startsWith('C')) return 'c-brown';     
        return 'c-gray';
    },

    filterTree() {
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
};

// ==========================================
// MODULE: CORE (Logic & Event Handling)
// ==========================================
const PP_Core = {
    currentProjectId: null,
    currentAreaId: null,
    currentDrawings: [],

    init() {
        PP_UI.init();
        
        // 1. Identify Project from URL immediately
        const ids = PP_Core.getIdsFromUrl();
        this.currentProjectId = ids.projectId;
        this.currentAreaId = ids.drawingAreaId;

        console.log("Procore Power-Up: Initializing for Project:", this.currentProjectId);

        // 2. Load from Storage (if available)
        if (this.currentProjectId) {
            PP_Store.getProjectData(this.currentProjectId).then(data => {
                if (data && data.drawings && data.drawings.length > 0) {
                    console.log("Procore Power-Up: Loaded from cache.");
                    this.currentDrawings = data.drawings;
                    // If stored Area ID is missing, update it from URL
                    if (!data.drawingAreaId && this.currentAreaId) data.drawingAreaId = this.currentAreaId;
                    
                    PP_UI.renderState('DATA', { ...data, projectId: this.currentProjectId });
                } else {
                    PP_UI.renderState('EMPTY');
                }
            });
        } else {
            // No project ID found in URL (Dashboard or non-project page)
            // We can optionally show a message or just leave empty
            PP_UI.renderState('EMPTY');
        }

        // 3. Listen for Network Traffic (The Wiretap)
        window.addEventListener("message", PP_Core.handleWiretapMessage);
    },

    getIdsFromUrl() {
        const url = window.location.href;
        const projectMatch = url.match(/projects\/(\d+)/) || url.match(/\/(\d+)\/project/);
        const areaMatch = url.match(/areas\/(\d+)/) || url.match(/drawing_areas\/(\d+)/);
        const companyMatch = url.match(/companies\/(\d+)/);
        
        return {
            companyId: companyMatch ? companyMatch[1] : null,
            projectId: projectMatch ? projectMatch[1] : null,
            drawingAreaId: areaMatch ? areaMatch[1] : null
        };
    },

    async handleWiretapMessage(event) {
        if (event.source !== window) return;
        if (event.data.type !== 'PP_DATA') return;

        const rawData = event.data.payload;
        const ids = event.data.ids || {};

        // Safety check: ensure wiretap IDs match our URL context
        const urlIds = PP_Core.getIdsFromUrl();
        const activeProjectId = urlIds.projectId || ids.projectId;
        const activeAreaId = urlIds.drawingAreaId || ids.drawingAreaId;
        const activeCompanyId = urlIds.companyId || ids.companyId;

        if (!activeProjectId) return; // Cannot save without Project ID

        const found = PP_Core.findDrawingsInObject(rawData);

        if (found.length > 0) {
            console.log(`Procore Power-Up: Wiretap captured ${found.length} items.`);
            
            // Merge logic: Combine new items with existing (deduplicating by ID)
            const existingIds = new Set(PP_Core.currentDrawings.map(d => d.id));
            const newItems = found.filter(d => !existingIds.has(d.id));
            
            if (newItems.length > 0 || PP_Core.currentDrawings.length === 0) {
                 // Add new items
                const cleanNewItems = newItems.map(d => ({
                    id: d.id,
                    number: d.number || d.drawing_number,
                    title: d.title,
                    discipline: d.discipline,
                    revision_number: d.revision_number || d.current_revision_id
                }));

                PP_Core.currentDrawings = [...PP_Core.currentDrawings, ...cleanNewItems];
                
                // Save to Storage
                const savedData = await PP_Store.saveProjectData(
                    activeProjectId, 
                    PP_Core.currentDrawings, 
                    activeCompanyId, 
                    activeAreaId
                );

                // Update UI
                PP_UI.renderState('DATA', { 
                    ...savedData, 
                    projectId: activeProjectId 
                });
            }
        }
    },

    findDrawingsInObject(obj) {
        if (!obj) return [];
        if (Array.isArray(obj)) return PP_Core.checkArray(obj);
        for (let key in obj) {
            if (Array.isArray(obj[key])) {
                const result = PP_Core.checkArray(obj[key]);
                if (result.length > 0) return result;
            }
        }
        return [];
    },

    checkArray(arr) {
        if (arr.length === 0) return [];
        const item = arr[0];
        // Heuristic to identify a "Drawing" object from Procore
        if (item.number || item.drawing_number || (item.id && item.discipline)) {
            return arr;
        }
        return [];
    },

    toggleSidebar() {
        PP_UI.toggle(!PP_UI.isOpen);
    },

    triggerLoadAll() {
        const btn = document.getElementById('pp-load-all');
        btn.innerText = "Expanding...";
        btn.disabled = true;

        const expandAllBtn = document.querySelector('.expand-button');

        if (!expandAllBtn) {
             // If we are NOT on the drawings page, this button might be confusing. 
             // Phase 2 will handle redirects. For now, alert user.
             alert("Could not find the 'Expand All' button. Please ensure you are on the Drawing Log page.");
             btn.innerText = "🔄 Load All Data";
             btn.disabled = false;
             return;
        }

        console.log("Procore Power-Up: Clicking 'Expand All'...");
        expandAllBtn.click();

        // Reset button
        setTimeout(() => {
            btn.innerText = "Done!";
            setTimeout(() => { 
                btn.innerText = "🔄 Load All Data"; 
                btn.disabled = false; 
            }, 2000);
        }, 1000);
    }
};

// --- INITIALIZE APP ---
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => PP_Core.init());
} else {
    PP_Core.init();
}