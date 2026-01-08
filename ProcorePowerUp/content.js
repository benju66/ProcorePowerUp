// content.js - Fix: Forced Sort Order & Debug

// --- 1. INJECT WIRETAP ---
const script = document.createElement('script');
script.src = chrome.runtime.getURL('injected.js');
script.onload = function() { this.remove(); };
(document.head || document.documentElement).appendChild(script);

// ==========================================
// MODULE: STORE
// ==========================================
const PP_Store = {
    async saveProjectData(projectId, drawings, companyId, areaId) {
        if (!projectId) return;
        const key = `pp_cache_${projectId}`;
        const payload = {
            timestamp: Date.now(),
            companyId,
            drawingAreaId: areaId,
            drawings: drawings
        };
        chrome.storage.local.set({ [key]: payload });
        return payload;
    },

    async saveDisciplineMap(projectId, mapData) {
        if (!projectId) return;
        const key = `pp_map_${projectId}`;
        // We overwrite the map completely to ensure sort order is fresh
        return new Promise((resolve) => {
            chrome.storage.local.set({ [key]: mapData }, () => resolve(mapData));
        });
    },

    async getProjectData(projectId) {
        if (!projectId) return { data: null, map: {} };
        const dKey = `pp_cache_${projectId}`;
        const mKey = `pp_map_${projectId}`;
        return new Promise((resolve) => {
            chrome.storage.local.get([dKey, mKey], (result) => {
                resolve({
                    data: result[dKey] || null,
                    map: result[mKey] || {}
                });
            });
        });
    }
};

// ==========================================
// MODULE: UI
// ==========================================
const PP_UI = {
    isOpen: false,

    init() {
        if (document.getElementById('pp-toggle-btn')) return;
        
        const toggleBtn = document.createElement('div');
        toggleBtn.id = 'pp-toggle-btn';
        toggleBtn.innerHTML = '📂'; 
        toggleBtn.onclick = () => PP_Core.toggleSidebar();
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
            <div id="pp-tree-content" class="pp-content"></div>
            <div class="pp-footer" id="pp-footer"></div>
        `;
        document.body.appendChild(sidebar);

        document.getElementById('pp-close').onclick = () => PP_Core.toggleSidebar();
        document.getElementById('pp-search').addEventListener('keyup', PP_UI.filterTree);
        document.getElementById('pp-load-all').addEventListener('click', PP_Core.triggerLoadAll);
    },

    toggle(openState) {
        this.isOpen = openState;
        document.getElementById('pp-sidebar').classList.toggle('open', openState);
    },

    renderState(stateType, payload = {}) {
        const treeRoot = document.getElementById('pp-tree-content');
        const footer = document.getElementById('pp-footer');
        
        if (stateType === 'LOADING') {
            treeRoot.innerHTML = `<div class="empty-state"><p>Loading...</p></div>`;
        } else if (stateType === 'EMPTY') {
            treeRoot.innerHTML = `<div class="empty-state"><p><strong>No drawings found.</strong></p><p>Please <b>Refresh the Page</b> to capture discipline names, then click "Load All Data".</p></div>`;
            footer.innerText = "";
        } else if (stateType === 'DATA') {
            PP_UI.buildTree(payload.drawings, payload.map, payload.projectId, payload.drawingAreaId);
            const dateStr = new Date(payload.timestamp).toLocaleString();
            footer.innerText = `Last updated: ${dateStr}`;
        }
    },

    buildTree(drawings, discMap, projectId, areaId) {
        const treeRoot = document.getElementById('pp-tree-content');
        treeRoot.innerHTML = ''; 

        const validDrawings = drawings.filter(d => d.number || d.drawing_number);
        if (validDrawings.length === 0) {
            treeRoot.innerHTML = '<div class="empty-state"><p>No valid drawings found.</p></div>';
            return;
        }

        const groups = {};
        const disciplineKeys = []; 

        validDrawings.forEach(dwg => {
            const num = dwg.number || dwg.drawing_number;
            const title = dwg.title || "No Title";
            const id = dwg.id;
            
            // --- DISCIPLINE LOGIC ---
            let discName = "General";
            let sortIndex = 9999; 

            if (dwg.discipline && dwg.discipline.id) {
                const mapEntry = discMap[dwg.discipline.id];
                if (mapEntry) {
                    discName = mapEntry.name || mapEntry; // Handle both Object and String formats
                    sortIndex = mapEntry.index !== undefined ? mapEntry.index : 9999;
                }
            } else if (dwg.discipline_name) {
                discName = dwg.discipline_name;
            }

            if (!groups[discName]) {
                groups[discName] = { items: [], order: sortIndex };
                disciplineKeys.push(discName);
            }
            groups[discName].items.push({ num, title, id, raw: dwg });
        });

        // --- SORT LOGIC ---
        disciplineKeys.sort((a, b) => {
            const orderA = groups[a].order;
            const orderB = groups[b].order;
            if (orderA !== 9999 && orderB !== 9999) return orderA - orderB;
            if (orderA !== 9999) return -1;
            if (orderB !== 9999) return 1;
            return a.localeCompare(b);
        });

        disciplineKeys.forEach(discipline => {
            const group = groups[discipline];
            const discContainer = document.createElement('details');
            discContainer.open = false; 
            
            const colorClass = PP_UI.getDisciplineColor(discipline);
            
            const summary = document.createElement('summary');
            summary.innerHTML = `<span class="disc-tag ${colorClass}">${discipline.charAt(0)}</span> ${discipline} (${group.items.length})`;
            discContainer.appendChild(summary);

            const list = document.createElement('ul');
            group.items.sort(PP_UI.sortDrawings).forEach(dwg => {
                list.appendChild(PP_UI.createDrawingRow(dwg, projectId, areaId));
            });

            discContainer.appendChild(list);
            treeRoot.appendChild(discContainer);
        });
    },

    createDrawingRow(dwg, projectId, areaId) {
        const pid = projectId || '3051002';
        const aid = areaId || '2532028'; 
        const linkUrl = `https://app.procore.com/${pid}/project/drawing_areas/${aid}/drawing_log/view_fullscreen/${dwg.id}`;

        const li = document.createElement('li');
        li.className = 'drawing-row';
        li.innerHTML = `
            <a href="${linkUrl}" target="_blank" class="drawing-link">
                <span class="d-num">${dwg.num}</span>
                <span class="d-title">${dwg.title}</span>
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
        document.querySelectorAll('.drawing-row').forEach(row => {
            const text = row.innerText.toLowerCase();
            const show = text.includes(term);
            row.style.display = show ? 'block' : 'none';
            if (show) row.closest('details').open = true;
        });
    }
};

// ==========================================
// MODULE: CORE
// ==========================================
const PP_Core = {
    currentProjectId: null,
    currentMap: {}, 

    init() {
        PP_UI.init();
        const ids = PP_Core.getIdsFromUrl();
        this.currentProjectId = ids.projectId;

        if (this.currentProjectId) {
            PP_Store.getProjectData(this.currentProjectId).then(res => {
                this.currentMap = res.map;
                if (res.data && res.data.drawings) {
                    PP_UI.renderState('DATA', { ...res.data, map: res.map, projectId: this.currentProjectId });
                } else {
                    PP_UI.renderState('EMPTY');
                }
            });
        }
        window.addEventListener("message", PP_Core.handleWiretapMessage);
    },

    getIdsFromUrl() {
        const url = window.location.href;
        const p = url.match(/projects\/(\d+)/) || url.match(/\/(\d+)\/project/);
        const a = url.match(/areas\/(\d+)/) || url.match(/drawing_areas\/(\d+)/);
        const c = url.match(/companies\/(\d+)/);
        return { companyId: c?c[1]:null, projectId: p?p[1]:null, drawingAreaId: a?a[1]:null };
    },

    async handleWiretapMessage(event) {
        if (event.source !== window || event.data.type !== 'PP_DATA') return;
        
        const rawData = event.data.payload;
        const ids = event.data.ids || {};
        const activeProjectId = PP_Core.getIdsFromUrl().projectId || ids.projectId;
        if (!activeProjectId) return;

        // --- MAP DISCOVERY ---
        const newMap = {};
        PP_Core.findDisciplinesRecursive(rawData, newMap, 0);
        
        if (Object.keys(newMap).length > 0) {
            // Log what we found to the console for debugging
            console.log("Procore Power-Up: 🎯 CAPTURED MAP:", newMap);
            
            this.currentMap = { ...this.currentMap, ...newMap };
            await PP_Store.saveDisciplineMap(activeProjectId, this.currentMap);
            
            PP_Store.getProjectData(activeProjectId).then(res => {
                 if (res.data) PP_UI.renderState('DATA', { ...res.data, map: this.currentMap, projectId: activeProjectId });
            });
        }

        // --- DRAWING DISCOVERY ---
        const foundDrawings = PP_Core.findDrawingsInObject(rawData);
        if (foundDrawings.length > 0) {
            const currentCache = await PP_Store.getProjectData(activeProjectId);
            let merged = currentCache.data ? currentCache.data.drawings : [];
            const existingIds = new Set(merged.map(d => d.id));
            
            const newItems = foundDrawings.filter(d => !existingIds.has(d.id)).map(d => ({
                id: d.id,
                number: d.number || d.drawing_number,
                title: d.title,
                discipline: d.discipline, 
                drawing_discipline: d.drawing_discipline,
                revision: d.revision_number
            }));

            if (newItems.length > 0) {
                merged = [...merged, ...newItems];
                const saved = await PP_Store.saveProjectData(activeProjectId, merged, ids.companyId, ids.drawingAreaId);
                PP_UI.renderState('DATA', { ...saved, map: this.currentMap, projectId: activeProjectId });
            }
        }
    },

    findDisciplinesRecursive(obj, map, sortCounter) {
        if (!obj || typeof obj !== 'object') return;
        
        // Strict Check: Must have ID and Name, but NOT be a drawing
        if (obj.id && obj.name && typeof obj.name === 'string' && !obj.drawing_number && !obj.number && !obj.title) {
            map[obj.id] = { name: obj.name, index: sortCounter };
        }

        if (Array.isArray(obj)) {
            obj.forEach((item, index) => {
                // IMPORTANT: We use the array index as the sort counter
                PP_Core.findDisciplinesRecursive(item, map, index); 
            });
        } else {
            for (const key in obj) {
                if (Object.prototype.hasOwnProperty.call(obj, key)) {
                    // If it's an object, we can't trust the order, so we pass the existing counter
                    PP_Core.findDisciplinesRecursive(obj[key], map, sortCounter);
                }
            }
        }
    },

    findDrawingsInObject(obj) {
        if (!obj) return [];
        if (Array.isArray(obj)) return PP_Core.checkDrawingArray(obj);
        for (let key in obj) {
            if (Array.isArray(obj[key])) {
                const res = PP_Core.checkDrawingArray(obj[key]);
                if (res.length > 0) return res;
            }
        }
        return [];
    },

    checkDrawingArray(arr) {
        if (arr.length === 0) return [];
        if (arr[0].number || arr[0].drawing_number) return arr;
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
        if (expandAllBtn) {
             expandAllBtn.click();
             setTimeout(() => { btn.innerText = "Done!"; btn.disabled = false; }, 2000);
        } else {
             window.location.reload();
        }
    }
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => PP_Core.init());
else PP_Core.init();