// -------------------------
// Select DOM elements
// -------------------------
const compileBtn = document.getElementById('compileBtn');
const downloadBtn = document.getElementById('downloadBtn');
const downloadPngBtn = document.getElementById('downloadPngBtn');
const svgContainer = document.getElementById('svgContainer');
const dslInput = document.getElementById('dslInput');

let panZoomInstance = null;
let originalSvgString = null; // Store clean SVG before pan-zoom modifications

// -------------------------
// Starter DSL
// -------------------------
const starterDSL = `# Starter Chen ER example

#colors
entities: #AED6F1
weak_entities: #D6EAF8
relationships: #FFE4B5

entity Student
entity Course
weak entity Enrollment

attribute Student id PK
attribute Student phone MULTI
attribute Student age DERIVED

composite Student address { street, city, zip }

relationship Enrolls
identifying relationship HasEnrollment

Enrolls Student (1) TOTAL -- (N) PARTIAL Course
`;

dslInput.value = starterDSL;

// -------------------------
// Render SVG using Graphviz WASM
// -------------------------
async function renderSVG(dot) {
    try {
        const graphviz = await window.GraphvizModule.load();
        const svgStr = graphviz.dot(dot);

        // Store the original clean SVG string for downloads
        originalSvgString = svgStr;

        // Convert string into DOM element
        const parser = new DOMParser();
        const svgDoc = parser.parseFromString(svgStr, "image/svg+xml");
        const svgElem = svgDoc.documentElement;

        // ── KEY FIX ──────────────────────────────────────────────────────
        // Graphviz emits fixed width/height in points (e.g. "2000pt").
        // When svg-pan-zoom tries to fit() a 2000pt canvas into a 400px
        // container the zoom factor becomes ~0.2 and every node appears
        // tiny.  Removing the fixed dimensions lets the SVG fill its
        // parent via CSS (100% / 100%) while the viewBox keeps the
        // internal coordinates intact so pan-zoom can work correctly.
        // ─────────────────────────────────────────────────────────────────
        svgElem.removeAttribute("width");
        svgElem.removeAttribute("height");
        svgElem.style.width  = "100%";
        svgElem.style.height = "100%";

        // Clear previous content and append SVG node
        svgContainer.innerHTML = "";
        svgContainer.appendChild(svgElem);

        // Destroy previous pan-zoom instance
        if (panZoomInstance) {
            panZoomInstance.destroy();
            panZoomInstance = null;
        }

        // Initialize new pan-zoom instance
        panZoomInstance = svgPanZoom(svgElem, {
            zoomEnabled: true,
            controlIconsEnabled: true,
            fit: true,
            center: true,
            minZoom: 0.05,
            maxZoom: 20
        });
    } catch (err) {
        svgContainer.innerHTML = `<p style="color:red;">Error: ${err.message}</p>`;
        console.error(err);
    }
}

// -------------------------
// Compile button
// -------------------------
compileBtn.addEventListener('click', async () => {
    try {
        const dot = parseDSL(dslInput.value);
        await renderSVG(dot);
    } catch (err) {
        svgContainer.innerHTML = `<p style="color:red;">Error: ${err.message}</p>`;
    }
});

// -------------------------
// Download SVG (use original, not modified)
// -------------------------
downloadBtn.addEventListener('click', () => {
    if (!originalSvgString) return alert('No SVG to download');

    const blob = new Blob([originalSvgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'chen_er_diagram.svg';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
});

// -------------------------
// Download PNG (render original SVG at proper resolution)
// -------------------------
downloadPngBtn.addEventListener('click', () => {
    if (!originalSvgString) return alert('No diagram to export');

    // Parse the original SVG to read its viewBox dimensions
    const parser = new DOMParser();
    const svgDoc = parser.parseFromString(originalSvgString, "image/svg+xml");
    const svgElem = svgDoc.documentElement;

    // Get viewBox or fall back to width/height attributes
    let vbWidth, vbHeight;
    const vb = svgElem.getAttribute("viewBox");
    if (vb) {
        const parts = vb.trim().split(/[\s,]+/);
        vbWidth  = parseFloat(parts[2]);
        vbHeight = parseFloat(parts[3]);
    } else {
        // Strip "pt" or "px" units from width/height
        vbWidth  = parseFloat(svgElem.getAttribute("width")  || "800");
        vbHeight = parseFloat(svgElem.getAttribute("height") || "600");
    }

    // Target a high-resolution export (2× the viewBox, capped at 4096)
    const MAX_PX = 4096;
    const scale  = Math.min(2, MAX_PX / Math.max(vbWidth, vbHeight));
    const canvasW = Math.round(vbWidth  * scale);
    const canvasH = Math.round(vbHeight * scale);

    // Build an SVG blob with explicit width/height for correct rasterisation
    const exportSvg = originalSvgString
        .replace(/<svg([^>]*)width="[^"]*"/, `<svg$1width="${canvasW}"`)
        .replace(/<svg([^>]*)height="[^"]*"/, `<svg$1height="${canvasH}"`)
        // If width/height attrs were missing, inject them
        .replace(/^(<svg(?![^>]*\bwidth=)[^>]*)>/, `$1 width="${canvasW}" height="${canvasH}">`);

    const blob = new Blob([exportSvg], { type: 'image/svg+xml;charset=utf-8' });
    const url  = URL.createObjectURL(blob);

    const img = new Image();
    img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width  = canvasW;
        canvas.height = canvasH;

        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvasW, canvasH);
        ctx.drawImage(img, 0, 0, canvasW, canvasH);

        URL.revokeObjectURL(url);

        const pngUrl = canvas.toDataURL('image/png');
        const link   = document.createElement('a');
        link.href     = pngUrl;
        link.download = 'chen_er_diagram.png';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    img.onerror = () => {
        URL.revokeObjectURL(url);
        alert('Failed to render PNG. Try downloading the SVG instead.');
    };

    img.src = url;
});

// -------------------------
// Auto-render on load
// -------------------------
window.addEventListener('load', async () => {
    const dot = parseDSL(dslInput.value);
    await renderSVG(dot);
});