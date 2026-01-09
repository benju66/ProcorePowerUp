// content.js - Procore Power-Up: Favorites, Drag-n-Drop & Robust Scans

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
        return new Promise((resolve) => {
            chrome.storage.local.set({ [key]: payload }, () => resolve(payload));
        });
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

    // --- FAVORITES & RECENTS ---
    async getFavorites(projectId) {
        if (!projectId) return [];
        const key = `pp_favs_${projectId}`;
        return new Promise(resolve => {
            chrome.storage.local.get([key], res => resolve(res[key] || []));
        });
    },

    async saveFavorites(projectId, folders) {
        if (!projectId) return;
        const key = `pp_favs_${projectId}`;
        chrome.storage.local.set({ [key]: folders });
    },

    async getRecents(projectId) {
        if (!projectId) return [];
        const key = `pp_recents_${projectId}`;
        return new Promise(resolve => {
            chrome.storage.local.get([key], res => resolve(res[key] || []));
        });
    },

    async saveRecents(projectId, recents) {
        if (!projectId) return;
        const key = `pp_recents_${projectId}`;
        chrome.storage.local.set({ [key]: recents });
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
// MODULE: FAVORITES & RECENTS LOGIC
// ==========================================
const PP_Favorites = {
    folders: [], 

    async init(projectId) {
        this.folders = await PP_Store.getFavorites(projectId);
        PP_UI.renderFavorites();
    },

    addFolder(name) {
        if (!name) return;
        this.folders.push({
            id: Date.now(),
            name: name, 
            drawings: []
        });
        this.save();
    },

    removeFolder(folderId) {
        if(!confirm("Delete this folder?")) return;
        this.folders = this.folders.filter(f => f.id !== folderId);
        this.save();
    },

    addDrawingToFolder(folderId, drawingNum) {
        const folder = this.folders.find(f => f.id === folderId);
        if (folder && !folder.drawings.includes(drawingNum)) {
            folder.drawings.push(drawingNum);
            this.save();
            return true; 
        }
        return false; 
    },

    removeDrawing(folderId, drawingNum) {
        const folder = this.folders.find(f => f.id === folderId);
        if (folder) {
            folder.drawings = folder.drawings.filter(d => d !== drawingNum);
            this.save();
        }
    },

    save() {
        PP_Store.saveFavorites(PP_Core.currentProjectId, this.folders);
        PP_UI.renderFavorites();
    }
};

const PP_Recents = {
    items: [], // Array of drawing Numbers

    async init(projectId) {
        this.items = await PP_Store.getRecents(projectId);
        PP_UI.renderRecents();
    },

    add(drawingNum) {
        // Remove if exists, add to top, limit to 5
        this.items = this.items.filter(n => n !== drawingNum);
        this.items.unshift(drawingNum);
        if (this.items.length > 5) this.items.pop();
        
        PP_Store.saveRecents(PP_Core.currentProjectId, this.items);
        PP_UI.renderRecents();
    }
};

// ==========================================
// MODULE: UI
// ==========================================
const PP_UI = {
    isOpen: false,
    activeDisciplineFilter: null,
    contextMenuOpen: false,

    async init() {
        if (document.getElementById('pp-toggle-btn')) return;
        
        const prefs = await PP_Store.getPreferences();

        // 1. Toggle Button
        const toggleBtn = document.createElement('div');
        toggleBtn.id = 'pp-toggle-btn';
        toggleBtn.textContent = '⚡';
        if (prefs.buttonTop) toggleBtn.style.top = prefs.buttonTop;
        
        this.makeDraggable(toggleBtn);
        
        toggleBtn.onclick = (e) => {
            if (toggleBtn.getAttribute('data-dragged') === 'true') return;
            PP_Core.toggleSidebar();
        };
        document.body.appendChild(toggleBtn);

        // 2. Sidebar
        const sidebar = document.createElement('div');
        sidebar.id = 'pp-sidebar';
        if (prefs.sidebarWidth) sidebar.style.width = `${prefs.sidebarWidth}px`;

        sidebar.innerHTML = `
            <div id="pp-resizer"></div> 
            
            <div class="pp-header">
                <h3>Procore Power-Up</h3>
                <span class="pp-close-btn" id="pp-close">&times;</span>
                <div id="pp-progress-bar"></div>
            </div>
            
            <div class="pp-search-box">
                <input type="text" id="pp-search" placeholder="Filter drawings... ( ↓ to nav )">
            </div>

            <details id="pp-recents-group" style="display:none" open>
                <summary class="pp-section-title"><span>🕒 Recent</span></summary>
                <div id="pp-recents-list" class="pp-simple-list"></div>
            </details>

            <details id="pp-favorites-group" open>
                <summary class="pp-section-title">
                    <span>⭐ Favorites</span>
                    <button id="pp-new-folder" class="pp-icon-btn" title="New Folder">+</button>
                </summary>
                <div id="pp-favorites-list" class="pp-fav-container"></div>
            </details>

            <div id="pp-tree-content" class="pp-content"></div>

            <div class="pp-footer-container">
                <div class="pp-controls">
                    <button id="pp-load-all" class="pp-btn-primary">🔄 Scan Project Data</button>
                </div>
                <div class="pp-footer" id="pp-footer"></div>
            </div>
            
            <div id="pp-drag-ghost" class="pp-drag-ghost"></div>
            
            <ul id="pp-context-menu" class="pp-context-menu"></ul>
        `;
        document.body.appendChild(sidebar);

        this.makeResizable(document.getElementById('pp-resizer'), sidebar);

        // Events
        document.getElementById('pp-close').onclick = () => PP_Core.toggleSidebar();
        const searchInput = document.getElementById('pp-search');
        
        // --- OPTIMIZATION 1: DEBOUNCED SEARCH ---
        // Instead of running on every keystroke, wait until user stops typing
        searchInput.addEventListener('input', PP_Core.debounce(() => {
            PP_UI.filterTree();
        }, 300));

        // Keyboard Nav
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                // Scope ONLY to #pp-tree-content
                const allVisible = Array.from(document.querySelectorAll('#pp-tree-content .pp-drawing-row'))
                    .filter(el => el.offsetParent !== null);
                
                const first = allVisible.find(row => !row.classList.contains('squeeze-out'));
                if (first) first.focus();

            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
            }
        });

        document.getElementById('pp-load-all').addEventListener('click', PP_Core.triggerLoadAll);
        
        document.getElementById('pp-new-folder').onclick = (e) => {
            e.preventDefault();
            e.stopPropagation(); // Prevent toggling the details summary
            const name = prompt("Enter folder name:");
            if(name) PP_Favorites.addFolder(name);
        };

        // Close context menu on global click
        document.addEventListener('click', () => {
            const menu = document.getElementById('pp-context-menu');
            if (menu) menu.style.display = 'none';
        });
    },

    // --- RECENTS RENDERING ---
    renderRecents() {
        const container = document.getElementById('pp-recents-list');
        const group = document.getElementById('pp-recents-group');
        
        if (!PP_Recents.items || PP_Recents.items.length === 0) {
            group.style.display = 'none';
            return;
        }

        group.style.display = 'block';
        container.innerHTML = '';
        
        const ul = document.createElement('ul');
        PP_Recents.items.forEach(num => {
            const fullData = PP_Core.getDrawingByNum(num);
            if (fullData) {
                const li = PP_UI.createDrawingRow(fullData, PP_Core.currentProjectId, PP_Core.cachedAreaId, true);
                ul.appendChild(li);
            }
        });
        container.appendChild(ul);
    },

    // --- FAVORITES RENDERING ---
    renderFavorites() {
        const container = document.getElementById('pp-favorites-list');
        container.innerHTML = '';

        if (PP_Favorites.folders.length === 0) {
            container.innerHTML = `<div class="pp-fav-empty">No folders yet.</div>`;
            return;
        }

        PP_Favorites.folders.forEach(folder => {
            const folderEl = document.createElement('details');
            folderEl.className = 'pp-fav-folder';
            folderEl.open = true;

            // Drag Drop Targets
            folderEl.ondragover = (e) => { e.preventDefault(); folderEl.classList.add('drag-over'); };
            folderEl.ondragleave = () => folderEl.classList.remove('drag-over');
            folderEl.ondrop = (e) => {
                e.preventDefault();
                folderEl.classList.remove('drag-over');
                const num = e.dataTransfer.getData("text/plain");
                if (num) {
                    const added = PP_Favorites.addDrawingToFolder(folder.id, num);
                    if (added !== false) { 
                        folderEl.classList.add('pp-gulp');
                        setTimeout(() => folderEl.classList.remove('pp-gulp'), 500);
                    }
                }
            };

            const summary = document.createElement('summary');
            const nameSpan = document.createElement('span');
            nameSpan.className = 'pp-folder-name';
            nameSpan.textContent = folder.name;
            
            const delBtn = document.createElement('span');
            delBtn.className = 'pp-del-folder';
            delBtn.innerHTML = '&times;';
            delBtn.title = "Delete Folder";
            delBtn.onclick = (e) => {
                e.preventDefault(); 
                PP_Favorites.removeFolder(folder.id);
            };

            summary.appendChild(nameSpan);
            summary.appendChild(delBtn);
            folderEl.appendChild(summary);

            const list = document.createElement('ul');
            folder.drawings.forEach(num => {
                const fullData = PP_Core.getDrawingByNum(num);
                const li = document.createElement('li');
                li.className = 'pp-fav-item';

                if (fullData) {
                    const a = document.createElement('a');
                    a.href = PP_Core.getDrawingUrl(fullData.id);
                    a.target = "_blank";
                    a.textContent = `${num} - ${fullData.title}`;
                    a.onclick = () => PP_Recents.add(num); // Track Recent
                    li.appendChild(a);
                } else {
                    li.innerHTML = `<span class="pp-missing">${num} (Need Scan)</span>`;
                }

                const removeSpan = document.createElement('span');
                removeSpan.className = 'pp-del-item';
                removeSpan.innerHTML = '&times;';
                removeSpan.onclick = () => PP_Favorites.removeDrawing(folder.id, num);
                li.appendChild(removeSpan);

                list.appendChild(li);
            });

            folderEl.appendChild(list);
            container.appendChild(folderEl);
        });
    },

    // --- MAIN TREE RENDERING ---
    updateLoadButton(text, disabled, progressPercent = 0) {
        const btn = document.getElementById('pp-load-all');
        const bar = document.getElementById('pp-progress-bar');
        if (btn) {
            btn.innerText = text;
            btn.disabled = disabled;
        }
        if (bar) {
            bar.style.width = `${progressPercent}%`;
            bar.style.opacity = progressPercent > 0 && progressPercent < 100 ? 1 : 0;
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
            if (newWidth > 200 && newWidth < 800) sidebar.style.width = `${newWidth}px`;
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
            treeRoot.innerHTML = `
                <div class="pp-skeleton-row"></div>
                <div class="pp-skeleton-row" style="width: 80%"></div>
                <div class="pp-skeleton-row" style="width: 90%"></div>
                <div class="pp-skeleton-row" style="width: 70%"></div>
            `;
        } else if (stateType === 'EMPTY') {
            treeRoot.innerHTML = `<div class="pp-empty-state"><p><strong>No drawings found.</strong></p><p>Please <b>Refresh the Page</b> to capture discipline names, then click "Scan Project Data".</p></div>`;
            footer.innerText = "";
        } else if (stateType === 'DATA') {
            PP_Core.cachedDrawings = payload.drawings; 
            PP_Core.cachedAreaId = payload.drawingAreaId;

            PP_UI.buildTree(payload.drawings, payload.map, payload.projectId, payload.drawingAreaId);
            PP_UI.renderFavorites(); 
            PP_UI.renderRecents();
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
            return a.localeCompare(b);
        });

        disciplineKeys.forEach(discipline => {
            const group = groups[discipline];
            const discContainer = document.createElement('details');
            discContainer.open = false; 
            discContainer.dataset.discipline = discipline; // For filtering
            
            // Check Interactive Filter
            if (PP_UI.activeDisciplineFilter && PP_UI.activeDisciplineFilter !== discipline) {
                discContainer.style.display = 'none';
            }

            const colorClass = PP_UI.getDisciplineColor(discipline);
            
            const summary = document.createElement('summary');
            const tagSpan = document.createElement('span');
            tagSpan.className = `pp-disc-tag ${colorClass} interactive`;
            tagSpan.textContent = discipline.charAt(0);
            tagSpan.title = "Click to Filter/Unfilter";
            
            // INTERACTIVE BADGE CLICK
            tagSpan.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                PP_UI.toggleDisciplineFilter(discipline);
            };
            
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

    toggleDisciplineFilter(discipline) {
        const searchInput = document.getElementById('pp-search');
        if (PP_UI.activeDisciplineFilter === discipline) {
            PP_UI.activeDisciplineFilter = null; // Clear filter
            searchInput.placeholder = "Filter all drawings...";
        } else {
            PP_UI.activeDisciplineFilter = discipline;
            searchInput.placeholder = `Filtered: ${discipline}`;
            // Clear text search to avoid confusion
            searchInput.value = '';
        }
        
        // Re-run filter logic
        PP_UI.filterTree();
    },

    createDrawingRow(dwg, projectId, areaId, isRecent = false) {
        const li = document.createElement('li');
        li.className = 'pp-drawing-row';
        li.tabIndex = 0; // ENABLE KEYBOARD FOCUS
        
        // --- IMPROVED KEYBOARD NAVIGATION ---
        li.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                li.querySelector('a').click();
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                
                // Scope ONLY to #pp-tree-content
                const allVisible = Array.from(document.querySelectorAll('#pp-tree-content .pp-drawing-row'))
                    .filter(el => el.offsetParent !== null);
                const idx = allVisible.indexOf(li);
                
                if (idx > -1 && idx < allVisible.length - 1) {
                    allVisible[idx + 1].focus();
                }
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                
                // Scope ONLY to #pp-tree-content
                const allVisible = Array.from(document.querySelectorAll('#pp-tree-content .pp-drawing-row'))
                    .filter(el => el.offsetParent !== null);
                const idx = allVisible.indexOf(li);

                if (idx > 0) {
                    allVisible[idx - 1].focus();
                } else if (idx === 0) {
                    // Only jump back to search if we are at the very top of the MAIN TREE
                    document.getElementById('pp-search').focus();
                }
            }
        });

        // DRAG AND DROP - CUSTOM GHOST
        li.draggable = true;
        li.ondragstart = (e) => {
            e.dataTransfer.setData("text/plain", dwg.num);
            e.dataTransfer.effectAllowed = "copy";
            
            // Create Ghost
            const ghost = document.getElementById('pp-drag-ghost');
            ghost.textContent = dwg.num;
            e.dataTransfer.setDragImage(ghost, 0, 0);
        };

        // CONTEXT MENU (Quick Add)
        li.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            PP_UI.showContextMenu(e.clientX, e.clientY, dwg.num);
        });

        if (!projectId || !areaId) {
            const errSpan = document.createElement('span');
            errSpan.className = 'pp-error-msg';
            errSpan.textContent = `${dwg.num} (Context Missing)`;
            li.appendChild(errSpan);
            return li;
        }

        const linkUrl = `https://app.procore.com/${projectId}/project/drawing_areas/${areaId}/drawing_log/view_fullscreen/${dwg.id}`;
        
        const a = document.createElement('a');
        a.href = linkUrl;
        a.target = "_blank";
        a.className = 'pp-drawing-link';
        a.onclick = () => PP_Recents.add(dwg.num); // Track Click

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

    showContextMenu(x, y, drawingNum) {
        const menu = document.getElementById('pp-context-menu');
        menu.innerHTML = '';
        menu.style.top = `${y}px`;
        menu.style.left = `${x}px`;
        menu.style.display = 'block';

        if (PP_Favorites.folders.length === 0) {
            const li = document.createElement('li');
            li.textContent = "No folders created";
            li.style.color = "#999";
            menu.appendChild(li);
        } else {
            PP_Favorites.folders.forEach(folder => {
                const li = document.createElement('li');
                li.textContent = `Add to: ${folder.name}`;
                li.onclick = () => {
                    const added = PP_Favorites.addDrawingToFolder(folder.id, drawingNum);
                    if(added) alert(`Added ${drawingNum} to ${folder.name}`);
                    else alert("Already in folder");
                };
                menu.appendChild(li);
            });
        }
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

        sections.forEach(section => {
            // Logic 1: Discipline Filter
            const discName = section.dataset.discipline;
            if (PP_UI.activeDisciplineFilter && PP_UI.activeDisciplineFilter !== discName) {
                section.style.display = 'none';
                return;
            }

            // Logic 2: Search Term
            if (!term) {
                section.style.display = ''; 
                section.open = false;
                section.querySelectorAll('.pp-drawing-row').forEach(row => {
                    row.style.display = '';
                    row.classList.remove('squeeze-out'); // Remove squeeze
                });
                return;
            }

            let hasMatch = false;
            const rows = section.querySelectorAll('.pp-drawing-row');
            rows.forEach(row => {
                const text = row.textContent.toLowerCase();
                if (text.includes(term)) {
                    row.style.display = ''; 
                    row.classList.remove('squeeze-out');
                    hasMatch = true;
                } else {
                    // SQUEEZE ANIMATION
                    row.classList.add('squeeze-out');
                    setTimeout(() => { if(row.classList.contains('squeeze-out')) row.style.display = 'none'; }, 200);
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
    cachedDrawings: [], 
    cachedAreaId: null,
    isFlushing: false, 

    init() {
        PP_UI.init();
        const ids = PP_Core.getIdsFromUrl();
        this.currentProjectId = ids.projectId;

        if (this.currentProjectId) {
            PP_Favorites.init(this.currentProjectId);
            PP_Recents.init(this.currentProjectId);

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

    // --- UTILITY: DEBOUNCE ---
    debounce(func, wait) {
        let timeout;
        return function(...args) {
            const context = this;
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(context, args), wait);
        };
    },

    getIdsFromUrl() {
        const url = window.location.href;
        const p = url.match(/projects\/(\d+)/) || url.match(/\/(\d+)\/project/);
        const a = url.match(/areas\/(\d+)/) || url.match(/drawing_areas\/(\d+)/);
        const c = url.match(/companies\/(\d+)/);
        return { companyId: c?c[1]:null, projectId: p?p[1]:null, drawingAreaId: a?a[1]:null };
    },

    getDrawingByNum(num) {
        if (!this.cachedDrawings) return null;
        return this.cachedDrawings.find(d => 
            (d.number === num) || (d.drawing_number === num) || (d.num === num)
        );
    },

    getDrawingUrl(drawingId) {
        const ids = this.getIdsFromUrl();
        const pid = ids.projectId || this.currentProjectId;
        const aid = ids.drawingAreaId || this.cachedAreaId;
        if(!pid || !aid) return "#";
        return `https://app.procore.com/${pid}/project/drawing_areas/${aid}/drawing_log/view_fullscreen/${drawingId}`;
    },

    async handleWiretapMessage(event) {
        if (event.origin !== window.location.origin) return;
        if (event.source !== window || event.data.type !== 'PP_DATA') return;
        
        const rawData = event.data.payload;
        const ids = event.data.ids || {};
        const activeProjectId = PP_Core.getIdsFromUrl().projectId || ids.projectId;
        if (!activeProjectId) return;

        const newMap = {};
        PP_Core.findDisciplinesRecursive(rawData, newMap, 0, 0); 
        if (Object.keys(newMap).length > 0) {
            PP_Core.currentMap = { ...PP_Core.currentMap, ...newMap };
            PP_Store.saveDisciplineMap(activeProjectId, PP_Core.currentMap);
        }

        const foundDrawings = PP_Core.findDrawingsInObject(rawData);
        if (foundDrawings.length > 0) {
            PP_Core.dataBuffer.push(...foundDrawings);
            // Update button but keep progress bar indeterminate or pulsing if needed
            if (PP_Core.isScanning) PP_UI.updateLoadButton(`Scanning... (${PP_Core.dataBuffer.length} pending)`, true, 50);
            if (PP_Core.debounceTimer) clearTimeout(PP_Core.debounceTimer);
            PP_Core.debounceTimer = setTimeout(() => {
                PP_Core.flushBuffer(activeProjectId, ids);
            }, 1500);
        }
    },

    async flushBuffer(activeProjectId, ids) {
        if (PP_Core.isFlushing || PP_Core.dataBuffer.length === 0) return;
        PP_Core.isFlushing = true;
        
        try {
            PP_UI.updateLoadButton("Processing...", true, 80);

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

            PP_UI.updateLoadButton("Done!", false, 100);
            
            const btn = document.getElementById('pp-load-all');
            if (btn) {
                btn.classList.add('pp-pop');
                setTimeout(() => btn.classList.remove('pp-pop'), 500);
            }
            
            setTimeout(() => PP_UI.updateLoadButton("🔄 Scan Project Data", false, 0), 3000); 
            PP_Core.isScanning = false;
        } catch(err) {
            console.error("PP: Flush failed", err);
        } finally {
            PP_Core.isFlushing = false;
            if (PP_Core.dataBuffer.length > 0) {
                 setTimeout(() => PP_Core.flushBuffer(activeProjectId, ids), 500);
            }
        }
    },

    findDisciplinesRecursive(obj, map, sortCounter, depth) {
        if (depth > 5) return; 
        if (!obj || typeof obj !== 'object') return;
        
        if (obj.id && obj.name && typeof obj.name === 'string' && !obj.drawing_number && !obj.number) {
            map[obj.id] = { name: obj.name, index: sortCounter };
        }
        if (Array.isArray(obj)) {
            obj.forEach((item, index) => {
                PP_Core.findDisciplinesRecursive(item, map, index, depth + 1); 
            });
        } else {
            for (const key in obj) {
                if (Object.prototype.hasOwnProperty.call(obj, key)) {
                    if (['permissions', 'metadata', 'view_options'].includes(key)) continue;
                    PP_Core.findDisciplinesRecursive(obj[key], map, sortCounter, depth + 1);
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

    // --- OPTIMIZATION 2: SAFE SCROLL FINDER ---
    // Avoids scanning every DIV in the document (Layout Thrashing risk)
    findScrollContainer() {
        // 1. Try known Procore containers first
        const candidates = ['.ag-body-viewport', '.main-content', '#main_content', 'body'];
        for (const sel of candidates) {
            const el = document.querySelector(sel);
            if (el && el.scrollHeight > el.clientHeight + 100) return el;
        }
        // 2. Fallback: Default to window (Safe)
        return window;
    },

    async triggerLoadAll() {
        const currentUrl = window.location.href;
        const isDrawingPage = currentUrl.includes('/drawing_log') || currentUrl.includes('/drawings');
        
        if (!isDrawingPage) {
            if (PP_Core.currentProjectId) { 
                const ids = PP_Core.getIdsFromUrl();
                const targetUrl = `https://app.procore.com/${ids.projectId}/project/drawing_log`;
                if (confirm("You are not on the Drawings page.\n\nClick OK to go there now so we can scan.")) {
                    window.location.href = targetUrl;
                }
            } else {
                alert("Please go to the Project Drawings page first.");
            }
            return;
        }

        const expandAllBtn = document.querySelector('.expand-button'); 
        PP_Core.isScanning = true;
        PP_UI.updateLoadButton("⏳ Initializing Scan...", true, 10); 
        
        if (expandAllBtn) {
            const ariaLabel = expandAllBtn.getAttribute('aria-label') || "";
            if (ariaLabel.toLowerCase().includes('close')) {
                PP_UI.updateLoadButton("Resetting View...", true, 15);
                expandAllBtn.click(); 
                await new Promise(r => setTimeout(r, 800)); 
                expandAllBtn.click(); 
                await new Promise(r => setTimeout(r, 800)); 
            } else {
                expandAllBtn.click();
                await new Promise(r => setTimeout(r, 800));
            }
        }

        const scrollTarget = PP_Core.findScrollContainer();
        let currentScroll = 0;
        const scrollStep = 1500; 
        let patience = 0; 
        let lastHeight = 0;

        const scroller = setInterval(() => {
            if (scrollTarget === window) window.scrollTo(0, currentScroll);
            else scrollTarget.scrollTop = currentScroll;

            currentScroll += scrollStep;
            
            const scrollHeight = scrollTarget === window ? document.body.scrollHeight : scrollTarget.scrollHeight;
            const scrollTop = scrollTarget === window ? window.scrollY : scrollTarget.scrollTop;
            const clientHeight = scrollTarget === window ? window.innerHeight : scrollTarget.clientHeight;

            const progress = Math.min(Math.floor((scrollTop / scrollHeight) * 100), 99);
            // VISUAL PROGRESS BAR UPDATE
            PP_UI.updateLoadButton(`Scanning... ${progress}%`, true, progress);

            if ((clientHeight + scrollTop) >= scrollHeight - 100) {
                if (scrollHeight > lastHeight) {
                    patience = 0; 
                    lastHeight = scrollHeight;
                } else {
                    patience++;
                }

                if (patience >= 4) {
                    clearInterval(scroller);
                    if (scrollTarget === window) window.scrollTo(0, 0);
                    else scrollTarget.scrollTop = 0;
                    PP_UI.updateLoadButton("Processing Final Data...", true, 99);
                }
            }
        }, 400); 
    }
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => PP_Core.init());
else PP_Core.init();