const express = require('express');
const axios = require('axios');
const path = require('path');
const { capturePage } = require('./snapshot');
const app = express();
const PORT = process.env.PORT || 3000;

// Serve your public assets (spritesheet, json data, game engine logic)
app.use(express.static(path.join(__dirname, 'public')));

// THE PROXY ROUTE: Fetches the target site and strips its security headers
app.get('/proxy', async (req, res) => {
    const targetUrl = req.query.url;

    if (!targetUrl) {
        return res.status(400).send('Please provide a URL parameter. Example: /proxy?url=https://example.com');
    }

    try {
        // Render the page in headless Chrome and take a frozen copy with no scripts in it.
        // If Chrome can't capture it, fall back to the raw HTML with its scripts cut out. The
        // raw HTML downloads alongside the capture, so the fallback costs no extra wait.
        const rawPage = axios.get(targetUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        rawPage.catch(() => {}); // only awaited if the capture fails
        let html, finalUrl;
        try {
            ({ html, finalUrl } = await capturePage(targetUrl));
        } catch (captureError) {
            console.warn('Snapshot failed, using raw HTML:', captureError.message);
            const response = await rawPage;
            html = String(response.data)
                .replace(/<script\b[\s\S]*?<\/script>/gi, '')
                .replace(/<meta[^>]*http-equiv=[^>]*>/gi, '');
            finalUrl = (response.request.res && response.request.res.responseUrl) || targetUrl;
        }

        // Point the page's relative links (CSS, images, fonts) back at the real site,
        // and freeze it: no animations, transitions, text cursor or selection.
        const baseTag = `<base href="${finalUrl.replace(/"/g, '&quot;')}">`;
        const freezeStyle = '<style id="wd-freeze">' +
            '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}' +
            'html,body,body *{cursor:none!important;user-select:none!important}' +
            '</style>';
        html = /<head[^>]*>/i.test(html)
            ? html.replace(/<head[^>]*>/i, match => match + baseTag + freezeStyle)
            : baseTag + freezeStyle + html;

        // CRUCIAL: Inject your frontend MUGEN game engine right before the website's closing </body> tag.
        // The <base> tag above would send a relative src to the target site, so use our own origin.
        const ownOrigin = `${req.protocol}://${req.get('host')}`;
        const injectScript = `<script src="${ownOrigin}/game-engine.js"></script>`;
        html = /<\/body>/i.test(html)
            ? html.replace(/<\/body>/i, injectScript + '</body>')
            : html + injectScript;

        // Send the modified, vulnerable website back to the browser
        res.send(html);

    } catch (error) {
        console.error('Proxy Error:', error.message);
        res.status(500).send(`Failed to load target website: ${error.message}`);
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`🚀 Proxy server running at http://localhost:${PORT}`);
    console.log(`🔗 Try visiting: http://localhost:${PORT}/proxy?url=https://example.com`);
});
