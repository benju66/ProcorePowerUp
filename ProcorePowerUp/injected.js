// injected.js
(function() {
    console.log("Procore Power-Up: Wiretap active.");

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
        // SECURITY PATCH: Only broadcast to same origin
        window.postMessage({ 
            type: 'PP_DATA', 
            payload: data, 
            ids: getIds(),
            source: sourceUrl 
        }, window.location.origin);
    }

    function isRelevantUrl(url) {
        if (!url || !url.includes('procore.com')) return false;
        const lower = url.toLowerCase();
        if (lower.match(/\.(png|jpg|gif|css|js|pdf|zip|svg|woff)(\?.*)?$/)) return false;
        if (lower.includes('drawing_log') || lower.includes('drawing_revisions') || lower.includes('/drawings')) return true;
        if (lower.includes('groups') || lower.includes('discipline')) return true;
        return false;
    }

    const originalFetch = window.fetch;
    window.fetch = async function(input, init) {
        const response = await originalFetch(input, init);
        let url = (input instanceof Request) ? input.url : input;
        
        if (isRelevantUrl(url)) {
             const contentType = response.headers.get('content-type');
             const contentLength = response.headers.get('content-length');
             
             // GUARD: Only clone if JSON and under 1MB (approx) to avoid crashing on massive blobs
             const isJson = contentType && contentType.includes('application/json');
             const isSmallEnough = !contentLength || parseInt(contentLength) < 1000000;

             if (isJson && isSmallEnough) {
                 try {
                     const clone = response.clone();
                     clone.json().then(data => broadcast(data, url)).catch(e => {});
                 } catch (e) {}
             }
        }
        return response;
    };
    
    // Also patch XHR just in case
    const originalSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function() {
        this.addEventListener('load', function() {
            const url = this.responseURL || this._url;
            if (isRelevantUrl(url)) {
                try {
                    const contentType = this.getResponseHeader('Content-Type');
                    if (contentType && contentType.includes('application/json')) {
                        // XHR responseText is already in memory, so size check is less critical for crash prevention,
                        // but still good practice to wrap in try/catch.
                        const data = JSON.parse(this.responseText);
                        broadcast(data, url);
                    }
                } catch (e) { }
            }
        });
        return originalSend.apply(this, arguments);
    };
})();