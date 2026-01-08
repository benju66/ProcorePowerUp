// injected.js - The Network Wiretap
(function() {
    console.log("Procore Power-Up: Wiretap installed. Waiting for traffic...");

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

    function broadcast(data) {
        window.postMessage({ type: 'PP_DATA', payload: data, ids: getIds() }, '*');
    }

    // 1. Intercept XHR
    const originalSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function() {
        this.addEventListener('load', function() {
            const url = this.responseURL || this._url || "";
            if (url.includes('drawing_log') || url.includes('drawing_revisions')) {
                try {
                    const data = JSON.parse(this.responseText);
                    broadcast(data);
                } catch (e) { /* Not JSON */ }
            }
        });
        return originalSend.apply(this, arguments);
    };
    
    // 2. Intercept Fetch
    const originalFetch = window.fetch;
    window.fetch = async function(input, init) {
        let url = input;
        if (input instanceof Request) url = input.url;

        const response = await originalFetch(input, init);

        if (url && (url.includes('drawing_log') || url.includes('drawing_revisions'))) {
             const clone = response.clone();
             clone.json().then(data => {
                 broadcast(data);
             }).catch(e => {});
        }
        return response;
    };

})();