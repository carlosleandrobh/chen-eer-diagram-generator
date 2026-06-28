// ─────────────────────────────────────────────────────────────────────────────
// App wiring: DSL  →  parseDSL (model)  →  ChenDiagram.render (SVG + drag)
// ─────────────────────────────────────────────────────────────────────────────
const compileBtn     = document.getElementById('compileBtn');
const relayoutBtn    = document.getElementById('relayoutBtn');
const downloadBtn    = document.getElementById('downloadBtn');
const downloadPngBtn = document.getElementById('downloadPngBtn');
const svgContainer   = document.getElementById('svgContainer');
const dslInput       = document.getElementById('dslInput');
const spacingRange   = document.getElementById('spacingRange');

let diagram = null;   // current ChenDiagram instance (holds the live SVG + export)

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
HasEnrollment Enrollment (1) TOTAL -- (1) TOTAL Student
`;

dslInput.value = starterDSL;

function currentOpts() {
    return { spacing: parseFloat(spacingRange.value) };
}

function build() {
    try {
        const model = parseDSL(dslInput.value);
        diagram = ChenDiagram.render(svgContainer, model, currentOpts());
    } catch (err) {
        svgContainer.innerHTML = `<p style="color:red;padding:1rem;">Error: ${err.message}</p>`;
        console.error(err);
    }
}

// Compile / re-layout
compileBtn.addEventListener('click', build);
relayoutBtn.addEventListener('click', build);
spacingRange.addEventListener('change', build);

// ─────────────────────────────────────────────────────────────────────────────
// Download SVG
// ─────────────────────────────────────────────────────────────────────────────
downloadBtn.addEventListener('click', () => {
    if (!diagram) return alert('Compile a diagram first.');
    const blob = new Blob([diagram.getSVGString()], { type: 'image/svg+xml;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), { href: url, download: 'chen_er_diagram.svg' });
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
});

// ─────────────────────────────────────────────────────────────────────────────
// Download PNG  (rasterise the standalone SVG onto a high-DPI white canvas)
// ─────────────────────────────────────────────────────────────────────────────
downloadPngBtn.addEventListener('click', () => {
    if (!diagram) return alert('Compile a diagram first.');

    const svgStr = diagram.getSVGString();
    // read width/height the renderer wrote on the <svg>
    const m = svgStr.match(/width="([\d.]+)"\s+height="([\d.]+)"/);
    const srcW = m ? parseFloat(m[1]) : 1200;
    const srcH = m ? parseFloat(m[2]) : 800;

    const MAX_SIDE = 4096;
    const scale    = Math.min(2.5, MAX_SIDE / Math.max(srcW, srcH, 1));
    const canvasW  = Math.round(srcW * scale);
    const canvasH  = Math.round(srcH * scale);

    const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const img  = new Image();

    img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = canvasW; canvas.height = canvasH;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvasW, canvasH);
        ctx.drawImage(img, 0, 0, canvasW, canvasH);
        URL.revokeObjectURL(url);
        const a = Object.assign(document.createElement('a'),
            { href: canvas.toDataURL('image/png'), download: 'chen_er_diagram.png' });
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
    };
    img.onerror = () => { URL.revokeObjectURL(url); alert('PNG export failed. Try "Download SVG" instead.'); };
    img.src = url;
});

// Re-fit on container resize so the diagram stays framed
window.addEventListener('resize', () => { if (diagram) diagram.fit(); });

// First render
window.addEventListener('load', build);
