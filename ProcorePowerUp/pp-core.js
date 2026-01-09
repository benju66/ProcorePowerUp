// pp-core.js - Application Core & Business Logic

// --- FAVORITES LOGIC BRIDGE ---
const PP_Favorites = {
    folders: [], 
    async init(projectId) {
        this.folders = await PP_Store.getFavorites(projectId);
        PP_UI.renderFavorites();
    },
    addFolder(name) {
        if (!name) return;
        this.folders.push({ id: Date.now(), name: name, drawings: [] });
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

// --- RECENTS LOGIC BRIDGE ---
const PP_Recents = {
    items: [],
    async init(projectId) {
        this.items = await PP_Store.getRecents(projectId);
        PP_UI.renderRecents();
    },
    add(drawingNum) {
        this.items = this.items.filter(n => n !== drawingNum);
        this.items.unshift(drawingNum);
        if (this.items.length > 5) this.items.pop();
        PP_Store.saveRecents(PP_Core.currentProjectId, this.items);
        PP_UI.renderRecents();
    },
    refreshColors() {
        PP_UI.renderRecents();
    }
};

// --- CORE APPLICATION ---
const PP_Core = {
    currentProjectId: null,
    currentMap: {}, 
    dataBuffer: [],
    debounceTimer: null,
    isScanning: false,
    cachedDrawings: [], 
    cachedAreaId: null,
    cachedColorMap: {},
    isFlushing: false, 
    urlWatcherActive: false,
    reinitTimer: null,

    init() {
        PP_UI.init(); // Initialize UI and Settings
        const ids = this.getIdsFromUrl();
        this.currentProjectId = ids.projectId;

        this.startUrlWatcher();
        this.setupGlobalKeys(); 

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
        window.addEventListener("message", (e) => this.handleWiretapMessage(e));
    },

    setupGlobalKeys() {
        document.addEventListener('keydown', (e) => {
            // Cmd+K or Ctrl+K for Command Palette
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                e.preventDefault();
                PP_UI.toggleCmdPalette(true);
            }
        });
    },

    startUrlWatcher() {
        if (this.urlWatcherActive) return;
        this.urlWatcherActive = true;
        let lastUrl = location.href;
        const observer = new MutationObserver(() => {
            const url = location.href;
            if (url !== lastUrl) {
                lastUrl = url;
                if (this.reinitTimer) clearTimeout(this.reinitTimer);
                this.reinitTimer = setTimeout(() => {
                    console.log("Procore Power-Up: URL changed, refreshing context...");
                    this.init(); 
                }, 500);
            }
        });
        observer.observe(document, { subtree: true, childList: true });
    },

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

    toggleSidebar() {
        PP_UI.toggle(!PP_UI.isOpen);
    },

    // --- WIRETAP LOGIC ---
    handleWiretapMessage(event) {
        if (event.origin !== window.location.origin) return;
        if (event.source !== window || event.data.type !== 'PP_DATA') return;
        
        const rawData = event.data.payload;
        const ids = event.data.ids || {};
        const activeProjectId = this.getIdsFromUrl().projectId || ids.projectId;
        if (!activeProjectId) return;

        const newMap = {};
        this.findDisciplinesRecursive(rawData, newMap, 0, 0); 
        if (Object.keys(newMap).length > 0) {
            this.currentMap = { ...this.currentMap, ...newMap };
            PP_Store.saveDisciplineMap(activeProjectId, this.currentMap);
        }

        const foundDrawings = this.findDrawingsInObject(rawData);
        if (foundDrawings.length > 0) {
            this.dataBuffer.push(...foundDrawings);
            if (this.isScanning) PP_UI.updateLoadButton(`Scanning... (${this.dataBuffer.length} pending)`, true, 50);
            if (this.debounceTimer) clearTimeout(this.debounceTimer);
            this.debounceTimer = setTimeout(() => {
                this.flushBuffer(activeProjectId, ids);
            }, 1500);
        }
    },

    async flushBuffer(activeProjectId, ids) {
        if (this.isFlushing || this.dataBuffer.length === 0) return;
        this.isFlushing = true;
        
        try {
            PP_UI.updateLoadButton("Processing...", true, 80);

            const currentCache = await PP_Store.getProjectData(activeProjectId);
            let merged = currentCache.data ? currentCache.data.drawings : [];
            const existingIds = new Set(merged.map(d => d.id));

            const newItems = this.dataBuffer
                .filter(d => !existingIds.has(d.id))
                .map(d => ({
                    id: d.id,
                    num: d.number || d.drawing_number,
                    title: d.title,
                    discipline: d.discipline, 
                    discipline_name: d.discipline_name || (d.discipline ? d.discipline.name : null)
                }));

            this.dataBuffer = [];

            if (newItems.length > 0) {
                merged = [...merged, ...newItems];
                const areaIdToSave = ids.drawingAreaId || (currentCache.data ? currentCache.data.drawingAreaId : null);
                const saved = await PP_Store.saveProjectData(activeProjectId, merged, ids.companyId, areaIdToSave);
                PP_UI.renderState('DATA', { ...saved, map: this.currentMap, projectId: activeProjectId });
            }

            PP_UI.updateLoadButton("Done!", false, 100);
            const btn = document.getElementById('pp-load-all');
            if (btn) {
                btn.classList.add('pp-pop');
                setTimeout(() => btn.classList.remove('pp-pop'), 500);
            }
            setTimeout(() => PP_UI.updateLoadButton("🔄 Scan Project Data", false, 0), 3000); 
            this.isScanning = false;
        } catch(err) {
            console.error("PP: Flush failed", err);
        } finally {
            this.isFlushing = false;
            if (this.dataBuffer.length > 0) {
                 setTimeout(() => this.flushBuffer(activeProjectId, ids), 500);
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
                this.findDisciplinesRecursive(item, map, index, depth + 1); 
            });
        } else {
            for (const key in obj) {
                if (Object.prototype.hasOwnProperty.call(obj, key)) {
                    if (['permissions', 'metadata', 'view_options'].includes(key)) continue;
                    this.findDisciplinesRecursive(obj[key], map, sortCounter, depth + 1);
                }
            }
        }
    },

    findDrawingsInObject(obj) {
        if (!obj) return [];
        if (Array.isArray(obj)) return this.checkDrawingArray(obj);
        for (let key in obj) {
            if (Array.isArray(obj[key])) {
                const res = this.checkDrawingArray(obj[key]);
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

    findScrollContainer() {
        const candidates = ['.ag-body-viewport', '.main-content', '#main_content', 'body'];
        for (const sel of candidates) {
            const el = document.querySelector(sel);
            if (el && el.scrollHeight > el.clientHeight + 100) return el;
        }
        return window;
    },

    async triggerLoadAll() {
        const currentUrl = window.location.href;
        const isDrawingPage = currentUrl.includes('/drawing_log') || currentUrl.includes('/drawings');
        
        if (!isDrawingPage) {
            const ids = PP_Core.getIdsFromUrl();
            if (ids.projectId) {
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
        this.isScanning = true;
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

        const scrollTarget = this.findScrollContainer();
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