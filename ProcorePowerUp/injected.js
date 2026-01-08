// injected.js - The Network Wiretap (Manifest V3 Main World)
(function() {
    console.log("Procore Power-Up: Wiretap active in Main World.");

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

    // STRICT WHITELIST
    function isRelevantUrl(url) {
        if (!url || !url.includes('procore.com')) return false;
        
        const lower = url.toLowerCase();

        // 1. Exclude Binaries/Static (Performance Critical)
        if (lower.match(/\.(png|jpg|gif|css|js|pdf|zip|svg|woff)(\?.*)?$/)) return false;
        if (lower.includes('/pdf') || lower.includes('/download')) return false;

        // 2. Explicitly allow Drawing Endpoints
        if (lower.includes('drawing_log') || 
            lower.includes('drawing_revisions') || 
            lower.includes('drawing_areas') ||
            lower.includes('/drawings')) {
            return true;
        }

        // 3. Explicitly allow Metadata/Discipline Endpoints
        if (lower.includes('groups') || 
            lower.includes('discipline') ||
            lower.includes('configurable_field_sets')) {
            return true;
        }

        return false;
    }

    // 1. Intercept XHR
    const originalSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function() {
        this.addEventListener('load', function() {
            const url = this.responseURL || this._url;
            if (isRelevantUrl(url)) {
                // Sanity check Content-Type
                const contentType = this.getResponseHeader('Content-Type');
                if (contentType && !contentType.includes('application/json')) return;

                try {
                    const data = JSON.parse(this.responseText);
                    broadcast(data, url);
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
             // Clone only if JSON to avoid binary overhead
             const contentType = response.headers.get('content-type');
             if (contentType && contentType.includes('application/json')) {
                 const clone = response.clone();
                 clone.json().then(data => {
                     broadcast(data, url);
                 }).catch(e => {});
             }
        }
        return response;
    };

})();