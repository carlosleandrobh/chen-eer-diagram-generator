// ─────────────────────────────────────────────────────────────────────────────
// DOM elements
// ─────────────────────────────────────────────────────────────────────────────
const compileBtn    = document.getElementById('compileBtn');
const downloadBtn   = document.getElementById('downloadBtn');
const downloadPngBtn = document.getElementById('downloadPngBtn');
const svgContainer  = document.getElementById('svgContainer');
const dslInput      = document.getElementById('dslInput');

let panZoomInstance  = null;
let originalSvgString = null; // clean SVG from Graphviz (for downloads)

// ─────────────────────────────────────────────────────────────────────────────
// Starter DSL
// ─────────────────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse a Graphviz SVG string and return { width, height } in pixels.
 *
 * Graphviz emits width/height with a "pt" suffix (72 pt = 1 inch).
 * Browsers render SVG at 96 dpi, so:  px = pt * (96/72) = pt * 4/3
 *
 * If only a viewBox is present we use those values directly as px.
 */
function getSvgDimensions(svgString) {
    const parser = new DOMParser();
    const doc    = parser.parseFromString(svgString, "image/svg+xml");
    const el     = doc.documentElement;

    // Prefer viewBox
    const vb = el.getAttribute("viewBox");
    if (vb) {
        const [, , w, h] = vb.trim().split(/[\s,]+/).map(parseFloat);
        if (w > 0 && h > 0) return { width: w, height: h };
    }

    // Fall back to width/height attributes (strip "pt", "px", etc.)
    const parseAttr = attr => parseFloat(el.getAttribute(attr) || "0");
    const rawW = parseAttr("width");
    const rawH = parseAttr("height");
    const unit  = (el.getAttribute("width") || "").replace(/[0-9.\s-]/g, "").toLowerCase();

    if (unit === "pt") {
        return { width: rawW * (4 / 3), height: rawH * (4 / 3) };
    }
    return { width: rawW || 800, height: rawH || 600 };
}

// ─────────────────────────────────────────────────────────────────────────────
// Render SVG into the preview container
// ─────────────────────────────────────────────────────────────────────────────
async function renderSVG(dot) {
    try {
        const graphviz = await window.GraphvizModule.load();
        const svgStr   = graphviz.dot(dot);

        // Keep a clean copy for exports
        originalSvgString = svgStr;

        // Parse into a live DOM element
        const domParser = new DOMParser();
        const svgDoc    = domParser.parseFromString(svgStr, "image/svg+xml");
        const svgElem   = svgDoc.documentElement;

        // ── KEY FIX ────────────────────────────────────────────────────
        // Graphviz emits e.g. width="1234pt" / height="567pt".
        // svg-pan-zoom reads those pixel values to compute the fit-zoom,
        // producing an absurdly small zoom factor for large graphs.
        //
        // Solution: remove the fixed dimensions and let the SVG fill the
        // container via CSS (100% × 100%).  The viewBox attribute already
        // encodes the full coordinate space; svg-pan-zoom will use the
        // rendered element size (from getBoundingClientRect) instead.
        // ───────────────────────────────────────────────────────────────
        svgElem.removeAttribute("width");
        svgElem.removeAttribute("height");
        svgElem.style.cssText = "width:100%;height:100%;display:block;";

        // Swap into the container
        svgContainer.innerHTML = "";
        svgContainer.appendChild(svgElem);

        // Tear down any previous pan-zoom instance
        if (panZoomInstance) {
            try { panZoomInstance.destroy(); } catch (_) {}
            panZoomInstance = null;
        }

        // Give the browser 100 ms to paint the SVG at its final CSS size
        // before svg-pan-zoom measures it.  requestAnimationFrame runs
        // before the next paint and often gets a stale bounding box.
        setTimeout(() => {
            try {
                if (panZoomInstance) {
                    try { panZoomInstance.destroy(); } catch (_) {}
                    panZoomInstance = null;
                }
                panZoomInstance = svgPanZoom(svgElem, {
                    zoomEnabled:          true,
                    controlIconsEnabled:  true,
                    fit:                  false,   // we call fit manually below
                    center:               false,
                    minZoom:              0.02,
                    maxZoom:              50,
                    zoomScaleSensitivity: 0.3,
                });
                panZoomInstance.fit();
                panZoomInstance.center();
            } catch (e) {
                console.warn("svg-pan-zoom init failed:", e);
            }
        }, 100);

    } catch (err) {
        svgContainer.innerHTML = `<p style="color:red;padding:1rem;">Error: ${err.message}</p>`;
        console.error(err);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Compile button
// ─────────────────────────────────────────────────────────────────────────────
compileBtn.addEventListener('click', async () => {
    try {
        const dot = parseDSL(dslInput.value);
        await renderSVG(dot);
    } catch (err) {
        svgContainer.innerHTML = `<p style="color:red;padding:1rem;">Error: ${err.message}</p>`;
        console.error(err);
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// Download SVG  (clean original, not the stripped preview version)
// ─────────────────────────────────────────────────────────────────────────────
downloadBtn.addEventListener('click', () => {
    if (!originalSvgString) return alert('Compile a diagram first.');

    const blob = new Blob([originalSvgString], { type: 'image/svg+xml;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), {
        href:     url,
        download: 'chen_er_diagram.svg',
    });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
});

// ─────────────────────────────────────────────────────────────────────────────
// Download PNG
//
// Strategy
// ────────
// 1. Read the diagram dimensions from the original SVG's viewBox (or w/h attrs).
// 2. Build an export copy of the SVG with explicit pixel width/height so the
//    browser rasterises it at the correct size (not 0×0 or some tiny default).
// 3. Draw onto a high-DPI canvas (2× scale, capped at 4096 px on the long edge)
//    with a white background.
// ─────────────────────────────────────────────────────────────────────────────
downloadPngBtn.addEventListener('click', () => {
    if (!originalSvgString) return alert('Compile a diagram first.');

    const { width: srcW, height: srcH } = getSvgDimensions(originalSvgString);

    const MAX_SIDE = 4096;
    const scale    = Math.min(2, MAX_SIDE / Math.max(srcW, srcH, 1));
    const canvasW  = Math.round(srcW * scale);
    const canvasH  = Math.round(srcH * scale);

    // Inject explicit pixel dimensions into the SVG for rasterisation
    let exportSvg = originalSvgString;
    if (/\bwidth="/.test(exportSvg)) {
        exportSvg = exportSvg.replace(/(<svg[^>]*)\bwidth="[^"]*"/, `$1width="${canvasW}"`);
    } else {
        exportSvg = exportSvg.replace(/(<svg)/, `$1 width="${canvasW}"`);
    }
    if (/\bheight="/.test(exportSvg)) {
        exportSvg = exportSvg.replace(/(<svg[^>]*)\bheight="[^"]*"/, `$1height="${canvasH}"`);
    } else {
        exportSvg = exportSvg.replace(/(<svg)/, `$1 height="${canvasH}"`);
    }

    const blob = new Blob([exportSvg], { type: 'image/svg+xml;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const img  = new Image();

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
        const a = Object.assign(document.createElement('a'), {
            href:     pngUrl,
            download: 'chen_er_diagram.png',
        });
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    };

    img.onerror = () => {
        URL.revokeObjectURL(url);
        alert('PNG export failed. Try "Download SVG" instead.');
    };

    img.src = url;
});

// ─────────────────────────────────────────────────────────────────────────────
// Auto-render on first load
// ─────────────────────────────────────────────────────────────────────────────
window.addEventListener('load', async () => {
    try {
        const dot = parseDSL(dslInput.value);
        await renderSVG(dot);
    } catch (err) {
        console.error("Auto-render failed:", err);
    }
});