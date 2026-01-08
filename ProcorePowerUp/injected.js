// injected.js - The Wide Net Wiretap
(function() {
    console.log("Procore Power-Up: Wiretap v3.0 installed. Waiting for traffic...");

    function getIds() {
        const url = window.location.href;
        const projectMatch = url.match(/projects\/(\d+)/) || url.match(/\/(\d+)\/project/);
        const areaMatch = url.match(/areas\/(\d+)/) || url.match(/drawing_areas\/(\d+)/);
        const companyMatch = url.match(/companies\/(\d+)/);
        
        return {
            companyId: companyMatch ? companyMatch[1] : '8906',
            projectId: projectMatch ? projectMatch[1] : '3051002',
            drawingAreaId: areaMatch ? areaMatch[1] : '2532028'
        };
    }

    // Check if a URL is interesting
    function isTargetUrl(url) {
        if (!url) return false;
        // Capture ANYTHING related to drawings data
        return (url.includes('drawing_log') || url.includes('drawing_revisions')) && 
               !url.includes('.js') && // Ignore javascript files
               !url.includes('.css');  // Ignore styles
    }

    // --- 1. INTERCEPT XHR ---
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function(method, url) {
        this._url = url; 
        return originalOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function() {
        this.addEventListener('load', function() {
            if (isTargetUrl(this._url)) {
                console.log("Procore Power-Up: 🎯 Match (XHR):", this._url);
                try {
                    const data = JSON.parse(this.responseText);
                    window.postMessage({ type: 'PP_DATA', payload: data, ids: getIds() }, '*');
                } catch (e) { /* Ignore non-JSON */ }
            }
        });
        return originalSend.apply(this, arguments);
    };
    
    // --- 2. INTERCEPT FETCH ---
    const originalFetch = window.fetch;
    window.fetch = async function(input, init) {
        let url = input;
        if (input instanceof Request) url = input.url;

        const response = await originalFetch(input, init);

        if (isTargetUrl(response.url)) {
             console.log("Procore Power-Up: 🎯 Match (Fetch):", response.url);
             const clone = response.clone();
             clone.json().then(data => {
                 window.postMessage({ type: 'PP_DATA', payload: data, ids: getIds() }, '*');
             }).catch(e => {});
        }

        return response;
    };

})();