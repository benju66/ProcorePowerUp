// pp-ui.js - User Interface Logic

const PP_UI = {
    isOpen: false,
    activeDisciplineFilter: null,
    settings: { openNewTab: true }, // Local copy of settings

    async init() {
        // Prevent re-creating UI on SPA re-init
        if (document.getElementById('pp-toggle-btn')) return;
        
        // Load Settings & Prefs
        this.settings = await PP_Store.getSettings();
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

        // 2. Sidebar Structure
        const sidebar = document.createElement('div');
        sidebar.id = 'pp-sidebar';
        if (prefs.sidebarWidth) sidebar.style.width = `${prefs.sidebarWidth}px`;

        sidebar.innerHTML = `
            <div id="pp-resizer"></div> 
            
            <div class="pp-header">
                <h3>Procore Power-Up</h3>
                <div class="pp-header-icons">
                     <span class="pp-icon-btn" id="pp-settings-btn" title="Settings">⚙️</span>
                     <span class="pp-close-btn" id="pp-close">&times;</span>
                </div>
                <div id="pp-progress-bar"></div>
            </div>
            
            <div class="pp-search-box">
                <input type="text" id="pp-search" placeholder="Filter drawings... (Cmd+K)">
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

            <div id="pp-settings-modal" class="pp-modal" style="display:none;">
                <div class="pp-modal-content">
                    <h4>Settings</h4>
                    <label class="pp-checkbox-row">
                        <input type="checkbox" id="pp-setting-newtab"> 
                        Open drawings in new tab
                    </label>
                    <div class="pp-modal-footer">
                        <button id="pp-settings-save" class="pp-btn-primary">Save</button>
                    </div>
                </div>
            </div>

            <div id="pp-cmd-palette" class="pp-cmd-overlay" style="display:none;">
                <div class="pp-cmd-box">
                    <input type="text" id="pp-cmd-input" placeholder="Type to search drawings..." autocomplete="off">
                    <ul id="pp-cmd-results"></ul>
                </div>
            </div>
        `;
        document.body.appendChild(sidebar);

        this.makeResizable(document.getElementById('pp-resizer'), sidebar);

        // --- Event Listeners ---
        document.getElementById('pp-close').onclick = () => PP_Core.toggleSidebar();
        const searchInput = document.getElementById('pp-search');
        searchInput.addEventListener('input', PP_Core.debounce(() => {
            this.filterTree();
        }, 300));

        // Keyboard Nav for Sidebar Tree
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
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
            e.stopPropagation();
            const name = prompt("Enter folder name:");
            if(name) PP_Favorites.addFolder(name);
        };

        // Global Click to close context menu
        document.addEventListener('click', () => {
            const menu = document.getElementById('pp-context-menu');
            if (menu) menu.style.display = 'none';
        });

        // Browser Action Toggle
        chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
            if (msg.action === "TOGGLE_UI") {
                const btn = document.getElementById('pp-toggle-btn');
                if (btn) {
                    const currentStyle = window.getComputedStyle(btn).display;
                    btn.style.display = (currentStyle === 'none') ? 'flex' : 'none';
                }
            }
        });

        // --- Settings Events ---
        document.getElementById('pp-settings-btn').onclick = () => this.toggleSettings(true);
        document.getElementById('pp-settings-save').onclick = () => this.saveSettingsFromUI();
        document.getElementById('pp-settings-modal').onclick = (e) => {
            if(e.target.id === 'pp-settings-modal') this.toggleSettings(false);
        };

        // --- Command Palette Events ---
        const cmdInput = document.getElementById('pp-cmd-input');
        cmdInput.addEventListener('input', (e) => this.filterCmdPalette(e.target.value));
        cmdInput.addEventListener('keydown', (e) => this.navigateCmdPalette(e));
        document.getElementById('pp-cmd-palette').onclick = (e) => {
             if(e.target.id === 'pp-cmd-palette') this.toggleCmdPalette(false);
        };
    },

    // --- SETTINGS LOGIC ---
    toggleSettings(show) {
        const modal = document.getElementById('pp-settings-modal');
        const checkbox = document.getElementById('pp-setting-newtab');
        if (show) {
            checkbox.checked = this.settings.openNewTab;
            modal.style.display = 'flex';
        } else {
            modal.style.display = 'none';
        }
    },

    async saveSettingsFromUI() {
        const checkbox = document.getElementById('pp-setting-newtab');
        this.settings.openNewTab = checkbox.checked;
        await PP_Store.saveSettings(this.settings);
        this.toggleSettings(false);
        
        // Re-render tree to apply new link targets
        const data = await PP_Store.getProjectData(PP_Core.currentProjectId);
        if(data && data.data) {
            this.buildTree(data.data.drawings, data.map, PP_Core.currentProjectId, data.data.drawingAreaId);
        }
    },

    // --- COMMAND PALETTE LOGIC ---
    toggleCmdPalette(show) {
        const overlay = document.getElementById('pp-cmd-palette');
        const input = document.getElementById('pp-cmd-input');
        if (show) {
            overlay.style.display = 'flex';
            input.value = '';
            input.focus();
            this.filterCmdPalette('');
        } else {
            overlay.style.display = 'none';
        }
    },

    filterCmdPalette(term) {
        const list = document.getElementById('pp-cmd-results');
        list.innerHTML = '';
        if(!PP_Core.cachedDrawings) return;

        const cleanTerm = term.toLowerCase().trim();
        // Match Number OR Title
        const matches = PP_Core.cachedDrawings
            .filter(d => {
                const num = (d.number || d.drawing_number || d.num).toLowerCase();
                const title = (d.title || "").toLowerCase();
                return num.includes(cleanTerm) || title.includes(cleanTerm);
            })
            .slice(0, 10); // Limit to 10 results

        matches.forEach((d, index) => {
            const li = document.createElement('li');
            li.className = 'pp-cmd-item';
            if(index === 0) li.classList.add('selected');
            
            const num = d.number || d.drawing_number || d.num;
            li.innerHTML = `<span class="pp-cmd-num">${num}</span> <span class="pp-cmd-title">${d.title}</span>`;
            
            li.onclick = () => {
                this.openDrawing(d);
                this.toggleCmdPalette(false);
            };
            li.onmouseenter = () => {
                document.querySelectorAll('.pp-cmd-item').forEach(el => el.classList.remove('selected'));
                li.classList.add('selected');
            };
            list.appendChild(li);
        });
    },

    navigateCmdPalette(e) {
        const list = document.getElementById('pp-cmd-results');
        const items = Array.from(list.children);
        const selected = list.querySelector('.selected');
        let idx = items.indexOf(selected);

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            idx = (idx + 1) % items.length;
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            idx = (idx - 1 + items.length) % items.length;
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (selected) selected.click();
            return;
        } else if (e.key === 'Escape') {
            this.toggleCmdPalette(false);
            return;
        } else {
            return;
        }

        items.forEach(el => el.classList.remove('selected'));
        if (items[idx]) {
            items[idx].classList.add('selected');
            items[idx].scrollIntoView({ block: 'nearest' });
        }
    },

    openDrawing(dwg) {
        const url = PP_Core.getDrawingUrl(dwg.id);
        if (this.settings.openNewTab) {
            window.open(url, '_blank');
        } else {
            window.location.href = url;
        }
    },

    // --- MAIN UI HELPERS ---
    toggle(openState) {
        this.isOpen = openState;
        document.getElementById('pp-sidebar').classList.toggle('open', openState);
    },

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

            this.buildTree(payload.drawings, payload.map, payload.projectId, payload.drawingAreaId);
            this.renderFavorites(); 
            this.renderRecents();
            const dateStr = new Date(payload.timestamp).toLocaleString();
            footer.innerText = `Last updated: ${dateStr}`;
        }
    },

    // --- DRAWING TREE LOGIC ---
    async buildTree(drawings, discMap, projectId, areaId) {
        const treeRoot = document.getElementById('pp-tree-content');
        treeRoot.innerHTML = ''; 

        const validDrawings = drawings.filter(d => d.number || d.drawing_number || d.num);
        if (validDrawings.length === 0) {
            treeRoot.innerHTML = '<div class="pp-empty-state"><p>No valid drawings found.</p></div>';
            return;
        }

        const [expandedList, colorMap] = await Promise.all([
            PP_Store.getExpanded(projectId),
            PP_Store.getColors(projectId)
        ]);
        const expandedSet = new Set(expandedList);
        PP_Core.cachedColorMap = colorMap || {};

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
            
            if (expandedSet.has(discipline)) discContainer.open = true;
            else discContainer.open = false; 

            discContainer.addEventListener('toggle', () => {
                const isOpen = discContainer.open;
                PP_Store.getExpanded(projectId).then(current => {
                    const currentSet = new Set(current);
                    if (isOpen) currentSet.add(discipline);
                    else currentSet.delete(discipline);
                    PP_Store.saveExpanded(projectId, Array.from(currentSet));
                });
            });

            discContainer.dataset.discipline = discipline;
            
            if (this.activeDisciplineFilter && this.activeDisciplineFilter !== discipline) {
                discContainer.style.display = 'none';
            }

            const colorClass = this.getDisciplineColor(discipline);
            
            const summary = document.createElement('summary');
            const tagSpan = document.createElement('span');
            tagSpan.className = `pp-disc-tag ${colorClass} interactive`;
            tagSpan.textContent = discipline.charAt(0);
            tagSpan.title = "Click to Filter/Unfilter";
            
            tagSpan.onclick = (e) => {
                e.preventDefault(); e.stopPropagation();
                this.toggleDisciplineFilter(discipline);
            };
            
            const textNode = document.createTextNode(` ${discipline} (${group.items.length})`);
            
            summary.appendChild(tagSpan);
            summary.appendChild(textNode);
            discContainer.appendChild(summary);

            const list = document.createElement('ul');
            group.items.sort(this.sortDrawings).forEach(dwg => {
                list.appendChild(this.createDrawingRow(dwg, projectId, areaId));
            });

            discContainer.appendChild(list);
            treeRoot.appendChild(discContainer);
        });
    },

    createDrawingRow(dwg, projectId, areaId) {
        const li = document.createElement('li');
        li.className = 'pp-drawing-row';
        li.tabIndex = 0; 
        
        // Color Logic (Apply to Row)
        if (PP_Core.cachedColorMap && PP_Core.cachedColorMap[dwg.num]) {
            const colorClass = PP_Core.cachedColorMap[dwg.num].replace('pp-status-', 'pp-row-');
            li.classList.add(colorClass);
        }

        // Status Dot (Clickable Trigger)
        const dot = document.createElement('div');
        dot.className = 'pp-status-dot';
        dot.title = "Click to cycle color";
        dot.onclick = (e) => {
            e.preventDefault(); e.stopPropagation();
            this.cycleStatusColor(li, dwg.num, projectId);
        };
        li.appendChild(dot);

        // Context check
        if (!projectId || !areaId) {
            li.innerHTML += `<span class="pp-error-msg">${dwg.num} (Context Missing)</span>`;
            return li;
        }

        // Link
        const a = document.createElement('a');
        a.href = PP_Core.getDrawingUrl(dwg.id);
        a.className = 'pp-drawing-link';
        // Respect Setting
        a.target = this.settings.openNewTab ? "_blank" : "_self";
        a.onclick = () => PP_Recents.add(dwg.num);

        const spanNum = document.createElement('span');
        spanNum.className = 'pp-d-num';
        spanNum.textContent = dwg.num; 

        const spanTitle = document.createElement('span');
        spanTitle.className = 'pp-d-title';
        spanTitle.textContent = dwg.title;

        a.appendChild(spanNum);
        a.appendChild(spanTitle);
        li.appendChild(a);

        // Events
        li.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                a.click();
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                const allVisible = Array.from(document.querySelectorAll('#pp-tree-content .pp-drawing-row'))
                    .filter(el => el.offsetParent !== null);
                const idx = allVisible.indexOf(li);
                if (idx > -1 && idx < allVisible.length - 1) allVisible[idx + 1].focus();
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                const allVisible = Array.from(document.querySelectorAll('#pp-tree-content .pp-drawing-row'))
                    .filter(el => el.offsetParent !== null);
                const idx = allVisible.indexOf(li);
                if (idx > 0) allVisible[idx - 1].focus();
                else if (idx === 0) document.getElementById('pp-search').focus();
            }
        });

        li.draggable = true;
        li.ondragstart = (e) => {
            e.dataTransfer.setData("text/plain", dwg.num);
            e.dataTransfer.effectAllowed = "copy";
            const ghost = document.getElementById('pp-drag-ghost');
            ghost.textContent = dwg.num;
            e.dataTransfer.setDragImage(ghost, 0, 0);
        };

        li.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.showContextMenu(e.clientX, e.clientY, dwg.num);
        });

        return li;
    },

    cycleStatusColor(li, drawingNum, projectId) {
        const order = [
            'pp-row-green', 'pp-row-red', 'pp-row-yellow', 
            'pp-row-blue', 'pp-row-orange', 'pp-row-pink'
        ];
        
        let currentIndex = -1;
        for (let i = 0; i < order.length; i++) {
            if (li.classList.contains(order[i])) {
                currentIndex = i;
                li.classList.remove(order[i]); 
                break;
            }
        }

        let nextClass = null;
        if (currentIndex < order.length - 1) {
            nextClass = order[currentIndex + 1];
            li.classList.add(nextClass);
        }

        let storeValue = null;
        if (nextClass) storeValue = nextClass.replace('pp-row-', 'pp-status-'); // Store as status for consistency

        if (!PP_Core.cachedColorMap) PP_Core.cachedColorMap = {};
        
        if (storeValue) {
            PP_Core.cachedColorMap[drawingNum] = storeValue;
        } else {
            delete PP_Core.cachedColorMap[drawingNum];
        }
        PP_Store.saveColors(projectId, PP_Core.cachedColorMap);
        PP_Recents.refreshColors();
    },

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
                const li = this.createDrawingRow(fullData, PP_Core.currentProjectId, PP_Core.cachedAreaId);
                ul.appendChild(li);
            }
        });
        container.appendChild(ul);
    },

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
                    a.target = this.settings.openNewTab ? "_blank" : "_self";
                    a.textContent = `${num} - ${fullData.title}`;
                    a.onclick = () => PP_Recents.add(num);
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

    showContextMenu(x, y, drawingNum) {
        const menu = document.getElementById('pp-context-menu');
        menu.innerHTML = '';
        menu.style.top = `${y}px`;
        menu.style.left = `${x}px`;
        menu.style.display = 'block';

        const copyLi = document.createElement('li');
        copyLi.innerHTML = `📋 <b>Copy Link</b>`;
        copyLi.style.borderBottom = "1px solid #eee";
        copyLi.onclick = () => {
            const dwg = PP_Core.getDrawingByNum(drawingNum);
            if (dwg) {
                const url = PP_Core.getDrawingUrl(dwg.id);
                navigator.clipboard.writeText(url);
                copyLi.textContent = "Copied!";
                copyLi.style.color = "green";
                setTimeout(() => { menu.style.display = 'none'; }, 600);
            }
        };
        menu.appendChild(copyLi);

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

    toggleDisciplineFilter(discipline) {
        const searchInput = document.getElementById('pp-search');
        if (this.activeDisciplineFilter === discipline) {
            this.activeDisciplineFilter = null; 
            searchInput.placeholder = "Filter all drawings...";
        } else {
            this.activeDisciplineFilter = discipline;
            searchInput.placeholder = `Filtered: ${discipline}`;
            searchInput.value = '';
        }
        this.filterTree();
    },

    filterTree() {
        const term = document.getElementById('pp-search').value.toLowerCase().trim();
        const sections = document.querySelectorAll('#pp-tree-content details');

        sections.forEach(section => {
            const discName = section.dataset.discipline;
            if (this.activeDisciplineFilter && this.activeDisciplineFilter !== discName) {
                section.style.display = 'none';
                return;
            }

            if (!term) {
                section.style.display = ''; 
                section.open = false; // Collapse by default when clearing search? Or keep previous state? 
                // Let's defer to sticky state or false. Simple approach:
                // User can re-expand. Or we could check sticky state here.
                section.querySelectorAll('.pp-drawing-row').forEach(row => {
                    row.style.display = '';
                    row.classList.remove('squeeze-out');
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
    }
};