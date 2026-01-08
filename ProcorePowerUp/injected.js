// injected.js - The Network Wiretap (Strict Whitelist)
(function() {
    console.log("Procore Power-Up: Wiretap installed. Waiting for drawing traffic...");

    function getIds() {
        const url = window.location.href;
        const projectMatch = url.match(/projects\/(\d+)/) || url.match(/\/(\d+)\/project/);
        const areaMatch = url.match(/areas\/(\d+)/) || url.match(/drawing_areas\/(\d+)/);
        const companyMatch = url.match(/companies\/(\d+)/);
        
        return {
            companyId: companyMatch ? companyMatch[1] : null,
            projectId: projectMatch ? projectMatch[1] : null,
            drawingAreaId: areaMatch ? areaMatch[1] : null
        };
    }

    function broadcast(data, sourceUrl) {
        window.postMessage({ 
            type: 'PP_DATA', 
            payload: data, 
            ids: getIds(),
            source: sourceUrl 
        }, '*');
    }

    // STRICT WHITELIST: Only allow Drawing-related or Metadata URLs
    function isRelevantUrl(url) {
        if (!url || !url.includes('procore.com')) return false;
        
        // Exclude static assets
        if (url.includes('.js') || url.includes('.css') || url.includes('.png')) return false;

        // 1. Explicitly allow Drawing Endpoints
        if (url.includes('drawing_log') || 
            url.includes('drawing_revisions') || 
            url.includes('drawing_areas') ||
            url.includes('/drawings')) {
            return true;
        }

        // 2. Explicitly allow Metadata/Discipline Endpoints (The "Decoder Ring")
        if (url.includes('groups') || 
            url.includes('discipline') ||
            url.includes('configurable_field_sets')) {
            return true;
        }

        return false;
    }

    // 1. Intercept XHR
    const originalSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function() {
        this.addEventListener('load', function() {
            if (isRelevantUrl(this.responseURL || this._url)) {
                try {
                    const data = JSON.parse(this.responseText);
                    broadcast(data, this.responseURL || this._url);
                } catch (e) { /* Not JSON */ }
            }
        });
        return originalSend.apply(this, arguments);
    };
    
    // 2. Intercept Fetch
    const originalFetch = window.fetch;
    window.fetch = async function(input, init) {
        const response = await originalFetch(input, init);
        let url = (input instanceof Request) ? input.url : input;

        if (isRelevantUrl(url)) {
             const clone = response.clone();
             clone.json().then(data => {
                 broadcast(data, url);
             }).catch(e => {});
        }
        return response;
    };

})();