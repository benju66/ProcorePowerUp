// content.js - Procore Power-Up: AG Grid Target & Hard Reset Expand

// ==========================================
// MODULE: STORE
// ==========================================
const PP_Store = {
    async saveProjectData(projectId, drawings, companyId, areaId) {
        if (!projectId) return;
        const key = `pp_cache_${projectId}`;
        
        const leanDrawings = drawings.map(d => ({
            id: d.id,
            num: d.number || d.drawing_number || d.num,
            title: d.title,
            discipline: d.discipline,
            discipline_name: d.discipline_name
        }));

        const payload = {
            timestamp: Date.now(),
            companyId,
            drawingAreaId: areaId,
            drawings: leanDrawings
        };
        chrome.storage.local.set({ [key]: payload });
        return payload;
    },

    async saveDisciplineMap(projectId, mapData) {
        if (!projectId) return;
        const key = `pp_map_${projectId}`;
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
    },

    async getPreferences() {
        return new Promise((resolve) => {
            chrome.storage.local.get(['pp_prefs'], (result) => {
                resolve(result.pp_prefs || { sidebarWidth: 300, buttonTop: '50%' });
            });
        });
    },

    async savePreferences(prefs) {
        chrome.storage.local.get(['pp_prefs'], (result) => {
            const current = result.pp_prefs || {};
            const updated = { ...current, ...prefs };
            chrome.storage.local.set({ pp_prefs: updated });
        });
    }
};

// ==========================================
// MODULE: UI
// ==========================================
const PP_UI = {
    isOpen: false,

    async init() {
        if (document.getElementById('pp-toggle-btn')) return;
        
        const prefs = await PP_Store.getPreferences();

        // 1. Create Toggle Button
        const toggleBtn = document.createElement('div');
        toggleBtn.id = 'pp-toggle-btn';
        toggleBtn.textContent = '📂'; 
        if (prefs.buttonTop) toggleBtn.style.top = prefs.buttonTop;
        
        this.makeDraggable(toggleBtn);
        
        toggleBtn.onclick = (e) => {
            if (toggleBtn.getAttribute('data-dragged') === 'true') return;
            PP_Core.toggleSidebar();
        };
        document.body.appendChild(toggleBtn);

        // 2. Create Sidebar
        const sidebar = document.createElement('div');
        sidebar.id = 'pp-sidebar';
        
        if (prefs.sidebarWidth) sidebar.style.width = `${prefs.sidebarWidth}px`;

        sidebar.innerHTML = `
            <div id="pp-resizer"></div> 
            <div class="pp-header">
                <h3>Project Drawings</h3>
                <span class="pp-close-btn" id="pp-close">&times;</span>
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

        this.makeResizable(document.getElementById('pp-resizer'), sidebar);

        document.getElementById('pp-close').onclick = () => PP_Core.toggleSidebar();
        document.getElementById('pp-search').addEventListener('input', PP_UI.filterTree);
        document.getElementById('pp-load-all').addEventListener('click', PP_Core.triggerLoadAll);
    },

    updateLoadButton(text, disabled) {
        const btn = document.getElementById('pp-load-all');
        if (btn) {
            btn.innerText = text;
            btn.disabled = disabled;
        }
    },

    makeDraggable(element) {
        let isDragging = false;
        let startY, startTop;

        element.addEventListener('mousedown', (e) => {
            isDragging = true;
            startY = e.clientY;
            startTop = element.offsetTop;
            element.setAttribute('data-dragged', 'false');
            element.style.transition = 'none';
            e.preventDefault();
        });

        window.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            const deltaY = e.clientY - startY;
            if (Math.abs(deltaY) > 3) element.setAttribute('data-dragged', 'true');
            element.style.top = `${startTop + deltaY}px`;
        });

        window.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                element.style.transition = ''; 
                PP_Store.savePreferences({ buttonTop: element.style.top });
            }
        });
    },

    makeResizable(resizer, sidebar) {
        let isResizing = false;
        let startX, startWidth;

        resizer.addEventListener('mousedown', (e) => {
            isResizing = true;
            startX = e.clientX;
            startWidth = parseInt(window.getComputedStyle(sidebar).width, 10);
            resizer.classList.add('resizing');
            document.body.style.cursor = 'ew-resize';
            e.preventDefault();
        });

        window.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            const deltaX = startX - e.clientX; 
            const newWidth = startWidth + deltaX;
            if (newWidth > 200 && newWidth < 800) {
                sidebar.style.width = `${newWidth}px`;
            }
        });

        window.addEventListener('mouseup', () => {
            if (isResizing) {
                isResizing = false;
                resizer.classList.remove('resizing');
                document.body.style.cursor = '';
                PP_Store.savePreferences({ sidebarWidth: parseInt(sidebar.style.width, 10) });
            }
        });
    },

    toggle(openState) {
        this.isOpen = openState;
        document.getElementById('pp-sidebar').classList.toggle('open', openState);
    },

    renderState(stateType, payload = {}) {
        const treeRoot = document.getElementById('pp-tree-content');
        const footer = document.getElementById('pp-footer');
        
        if (stateType === 'LOADING') {
            treeRoot.innerHTML = `<div class="pp-empty-state"><p>Loading...</p></div>`;
        } else if (stateType === 'EMPTY') {
            treeRoot.innerHTML = `<div class="pp-empty-state"><p><strong>No drawings found.</strong></p><p>Please <b>Refresh the Page</b> to capture discipline names, then click "Load All Data".</p></div>`;
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

        const validDrawings = drawings.filter(d => d.number || d.drawing_number || d.num);
        
        if (validDrawings.length === 0) {
            treeRoot.innerHTML = '<div class="pp-empty-state"><p>No valid drawings found.</p></div>';
            return;
        }

        const groups = {};
        const disciplineKeys = []; 

        validDrawings.forEach(dwg => {
            const num = dwg.number || dwg.drawing_number || dwg.num;
            const title = dwg.title || "No Title";
            const id = dwg.id;
            
            let discName = "General";
            let sortIndex = 9999; 

            if (dwg.discipline && dwg.discipline.id) {
                const mapEntry = discMap[dwg.discipline.id];
                if (mapEntry) {
                    discName = mapEntry.name || mapEntry;
                    sortIndex = mapEntry.index !== undefined ? mapEntry.index : 9999;
                }
            } else if (dwg.discipline_name) {
                discName = dwg.discipline_name;
            }

            if (!groups[discName]) {
                groups[discName] = { items: [], order: sortIndex };
                disciplineKeys.push(discName);
            }
            groups[discName].items.push({ num, title, id });
        });

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
            
            const tagSpan = document.createElement('span');
            tagSpan.className = `pp-disc-tag ${colorClass}`;
            tagSpan.textContent = discipline.charAt(0);
            
            const textNode = document.createTextNode(` ${discipline} (${group.items.length})`);
            
            summary.appendChild(tagSpan);
            summary.appendChild(textNode);
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
        const li = document.createElement('li');
        li.className = 'pp-drawing-row';

        if (!projectId || !areaId) {
            const errSpan = document.createElement('span');
            errSpan.className = 'pp-error-msg';
            errSpan.style.color = '#999';
            errSpan.style.fontSize = '11px';
            errSpan.textContent = `${dwg.num} (Context Missing)`;
            li.appendChild(errSpan);
            return li;
        }

        const linkUrl = `https://app.procore.com/${projectId}/project/drawing_areas/${areaId}/drawing_log/view_fullscreen/${dwg.id}`;
        
        const a = document.createElement('a');
        a.href = linkUrl;
        a.target = "_blank";
        a.className = 'pp-drawing-link';

        const spanNum = document.createElement('span');
        spanNum.className = 'pp-d-num';
        spanNum.textContent = dwg.num; 

        const spanTitle = document.createElement('span');
        spanTitle.className = 'pp-d-title';
        spanTitle.textContent = dwg.title;

        a.appendChild(spanNum);
        a.appendChild(spanTitle);
        li.appendChild(a);

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
        const term = document.getElementById('pp-search').value.toLowerCase().trim();
        const sections = document.querySelectorAll('#pp-tree-content details');

        if (!term) {
            sections.forEach(section => {
                section.style.display = ''; 
                section.open = false;
                section.querySelectorAll('.pp-drawing-row').forEach(row => row.style.display = '');
            });
            return;
        }

        sections.forEach(section => {
            let hasMatch = false;
            const rows = section.querySelectorAll('.pp-drawing-row');

            rows.forEach(row => {
                const text = row.textContent.toLowerCase();
                if (text.includes(term)) {
                    row.style.display = ''; 
                    hasMatch = true;
                } else {
                    row.style.display = 'none'; 
                }
            });

            if (hasMatch) {
                section.style.display = '';
                section.open = true; 
            } else {
                section.style.display = 'none'; 
            }
        });
    }
};

// ==========================================
// MODULE: CORE
// ==========================================
const PP_Core = {
    currentProjectId: null,
    currentMap: {}, 
    dataBuffer: [],
    debounceTimer: null,
    isScanning: false,

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

        const newMap = {};
        PP_Core.findDisciplinesRecursive(rawData, newMap, 0);
        if (Object.keys(newMap).length > 0) {
            PP_Core.currentMap = { ...PP_Core.currentMap, ...newMap };
            PP_Store.saveDisciplineMap(activeProjectId, PP_Core.currentMap);
        }

        const foundDrawings = PP_Core.findDrawingsInObject(rawData);
        
        if (foundDrawings.length > 0) {
            PP_Core.dataBuffer.push(...foundDrawings);
            
            if (PP_Core.isScanning) {
                PP_UI.updateLoadButton(`Scanning... (${PP_Core.dataBuffer.length} pending)`, true);
            }

            if (PP_Core.debounceTimer) clearTimeout(PP_Core.debounceTimer);
            
            PP_Core.debounceTimer = setTimeout(() => {
                PP_Core.flushBuffer(activeProjectId, ids);
            }, 1500);
        }
    },

    async flushBuffer(activeProjectId, ids) {
        if (PP_Core.dataBuffer.length === 0) return;

        PP_UI.updateLoadButton("Processing...", true);

        const currentCache = await PP_Store.getProjectData(activeProjectId);
        let merged = currentCache.data ? currentCache.data.drawings : [];
        const existingIds = new Set(merged.map(d => d.id));

        const newItems = PP_Core.dataBuffer
            .filter(d => !existingIds.has(d.id))
            .map(d => ({
                id: d.id,
                num: d.number || d.drawing_number,
                title: d.title,
                discipline: d.discipline, 
                discipline_name: d.discipline_name || (d.discipline ? d.discipline.name : null)
            }));

        PP_Core.dataBuffer = [];

        if (newItems.length > 0) {
            merged = [...merged, ...newItems];
            const areaIdToSave = ids.drawingAreaId || (currentCache.data ? currentCache.data.drawingAreaId : null);
            
            const saved = await PP_Store.saveProjectData(activeProjectId, merged, ids.companyId, areaIdToSave);
            PP_UI.renderState('DATA', { ...saved, map: PP_Core.currentMap, projectId: activeProjectId });
        }

        PP_UI.updateLoadButton("Done!", false);
        setTimeout(() => PP_UI.updateLoadButton("🔄 Load All Data", false), 3000);
        PP_Core.isScanning = false;
    },

    findDisciplinesRecursive(obj, map, sortCounter) {
        if (!obj || typeof obj !== 'object') return;
        
        if (obj.id && obj.name && typeof obj.name === 'string' && !obj.drawing_number && !obj.number) {
            map[obj.id] = { name: obj.name, index: sortCounter };
        }

        if (Array.isArray(obj)) {
            obj.forEach((item, index) => {
                PP_Core.findDisciplinesRecursive(item, map, index); 
            });
        } else {
            for (const key in obj) {
                if (Object.prototype.hasOwnProperty.call(obj, key)) {
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
        if ((arr[0].number || arr[0].drawing_number) && arr[0].id) return arr;
        return [];
    },

    toggleSidebar() {
        PP_UI.toggle(!PP_UI.isOpen);
    },

    // ----------------------------------------------------------------------
    // NEW HELPER: Robust Scroll Container Finder
    // ----------------------------------------------------------------------
    findScrollContainer(startNode) {
        // 1. BEST TARGET: AG Grid Body Viewport (Standard Procore Grid)
        const agBody = document.querySelector('.ag-body-viewport');
        if (agBody) {
            console.log("PP: Found AG Grid viewport");
            return agBody;
        }

        // 2. Fallback: Largest scrollable div on screen
        const allDivs = document.querySelectorAll('div');
        let largestDiv = null;
        let maxScroll = 0;

        allDivs.forEach(div => {
            if (div.scrollHeight > div.clientHeight + 100) { 
                const style = window.getComputedStyle(div);
                if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
                    if (div.scrollHeight > maxScroll) {
                        maxScroll = div.scrollHeight;
                        largestDiv = div;
                    }
                }
            }
        });

        if (largestDiv) {
            console.log("PP: Using largest scroll container:", largestDiv);
            return largestDiv;
        }
        
        // 3. Last Resort: Window
        return window;
    },

    // ----------------------------------------------------------------------
    // UPDATED LOAD FUNCTION
    // ----------------------------------------------------------------------
    async triggerLoadAll() {
        const currentUrl = window.location.href;
        const isDrawingPage = currentUrl.includes('/drawing_log') || currentUrl.includes('/drawings');
        
        if (!isDrawingPage) {
            if (PP_Core.currentProjectId && PP_Core.currentMap) { 
                const ids = PP_Core.getIdsFromUrl();
                const targetUrl = `https://app.procore.com/${ids.projectId}/project/drawing_log`;
                if (confirm("You are not on the Drawings page. Redirect there now?")) {
                    window.location.href = targetUrl;
                }
            } else {
                alert("Please navigate to the Project Drawings tool to load data.");
            }
            return;
        }

        const expandAllBtn = document.querySelector('.expand-button'); 
        
        PP_Core.isScanning = true;
        PP_UI.updateLoadButton("🚀 Initializing Scan...", true);
        
        // --- STEP 1: FORCE RESET (THE FIX) ---
        // We do NOT trust the current state. "Close All" might mean only 1 folder is open.
        // We must Collapse everything first, then Open everything.
        if (expandAllBtn) {
            const ariaLabel = expandAllBtn.getAttribute('aria-label') || "";
            // If it says "Close", it means *some* or *all* are open. 
            // If it says "Expand", it means all are closed.
            
            const isPartiallyOrFullyExpanded = ariaLabel.toLowerCase().includes('close');

            if (isPartiallyOrFullyExpanded) {
                PP_UI.updateLoadButton("Resetting View...", true);
                expandAllBtn.click(); // Click to Collapse All
                await new Promise(r => setTimeout(r, 1000)); // Wait for render
                
                expandAllBtn.click(); // Click to Expand All
                await new Promise(r => setTimeout(r, 1000)); // Wait for render
            } else {
                // It says "Expand", so all are closed. Just click once.
                expandAllBtn.click();
                await new Promise(r => setTimeout(r, 1000));
            }
        }

        // --- STEP 2: LOCATE THE SCROLL JAIL ---
        const scrollTarget = PP_Core.findScrollContainer(expandAllBtn || document.querySelector('.drawing-row'));
        
        if (!scrollTarget || scrollTarget === window) {
            console.warn("PP: Could not locate specific scroll container. Defaulting to window.");
        }

        // --- STEP 3: TURBO SCROLL (With Patience) ---
        let currentScroll = 0;
        const scrollStep = 2500; 
        let patience = 0; 
        let lastHeight = 0;

        const scroller = setInterval(() => {
            if (scrollTarget === window) {
                window.scrollTo(0, currentScroll);
            } else {
                scrollTarget.scrollTop = currentScroll;
            }

            currentScroll += scrollStep;
            
            const scrollHeight = scrollTarget === window ? document.body.scrollHeight : scrollTarget.scrollHeight;
            const scrollTop = scrollTarget === window ? window.scrollY : scrollTarget.scrollTop;
            const clientHeight = scrollTarget === window ? window.innerHeight : scrollTarget.clientHeight;

            const progress = Math.min(Math.floor((scrollTop / scrollHeight) * 100), 99);
            PP_UI.updateLoadButton(`Scanning... ${progress}%`, true);

            if ((clientHeight + scrollTop) >= scrollHeight - 100) {
                if (scrollHeight > lastHeight) {
                    patience = 0; 
                    lastHeight = scrollHeight;
                } else {
                    patience++;
                }

                if (patience >= 3) {
                    clearInterval(scroller);
                    
                    if (scrollTarget === window) window.scrollTo(0, 0);
                    else scrollTarget.scrollTop = 0;

                    PP_UI.updateLoadButton("Processing Final Data...", true);
                }
            }
        }, 600); 
    }
};

// Initialize
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => PP_Core.init());
else PP_Core.init();