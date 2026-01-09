// pp-store.js - Data Persistence Layer

const PP_Store = {
    // --- SETTINGS ---
    async getSettings() {
        return new Promise(resolve => {
            chrome.storage.local.get(['pp_settings'], res => {
                // Default: Open in New Tab = true
                resolve(res.pp_settings || { openNewTab: true });
            });
        });
    },

    async saveSettings(settings) {
        chrome.storage.local.set({ pp_settings: settings });
    },

    // --- PROJECT DATA ---
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

    // --- STICKY FOLDERS ---
    async getExpanded(projectId) {
        if (!projectId) return [];
        const key = `pp_expanded_${projectId}`;
        return new Promise(resolve => {
            chrome.storage.local.get([key], res => resolve(res[key] || []));
        });
    },

    async saveExpanded(projectId, list) {
        if (!projectId) return;
        const key = `pp_expanded_${projectId}`;
        chrome.storage.local.set({ [key]: list });
    },

    // --- STATUS COLORS ---
    async getColors(projectId) {
        if (!projectId) return {};
        const key = `pp_colors_${projectId}`;
        return new Promise(resolve => {
            chrome.storage.local.get([key], res => resolve(res[key] || {}));
        });
    },

    async saveColors(projectId, colors) {
        if (!projectId) return;
        const key = `pp_colors_${projectId}`;
        chrome.storage.local.set({ [key]: colors });
    },

    // --- UI PREFERENCES ---
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