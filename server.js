const express = require('express');
const axios = require('axios');
const path = require('path');
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
        // Fetch the raw webpage from the internet
        const response = await axios.get(targetUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        let html = response.data;

        // Clean out security features that block iframes or external scripts
        html = html.replace(/<meta[^>]*http-equiv=["']Content-Security-Policy["'][^>]*>/gi, '');

        // Point the page's relative links (CSS, images, scripts) back at the real site,
        // using the final URL after any redirects
        const finalUrl = (response.request.res && response.request.res.responseUrl) || targetUrl;
        const baseTag = `<base href="${finalUrl.replace(/"/g, '&quot;')}">`;
        html = /<head[^>]*>/i.test(html)
            ? html.replace(/<head[^>]*>/i, match => match + baseTag)
            : baseTag + html;

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
