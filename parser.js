// ================================
// Chen ER DSL Parser → Graphviz DOT
// ================================
function parseDSL(dsl) {
    const lines = dsl
        .split("\n")
        .map(l => l.trim())
        .filter(l => l);

    const entities = {};
    const relationships = {};
    const attributes = [];
    const composites = [];
    const edges = [];

    // -------------------------
    // Default colors
    // -------------------------
    let entityColor = "#AED6F1";      // light blue
    let weakEntityColor = "#D6EAF8";  // light peach
    let relationshipColor = "#FFE4B5"; // light yellow

    // -------------------------
    // Parse DSL
    // -------------------------
    for (const line of lines) {
        if (line.startsWith("#") || line === "") continue;

        // Color config
        let m;
        if (m = line.match(/^entities\s*:\s*(#[0-9A-Fa-f]{3,6})$/)) { entityColor = m[1]; continue; }
        if (m = line.match(/^weak_entities\s*:\s*(#[0-9A-Fa-f]{3,6})$/)) { weakEntityColor = m[1]; continue; }
        if (m = line.match(/^relationships\s*:\s*(#[0-9A-Fa-f]{3,6})$/)) { relationshipColor = m[1]; continue; }

        // Entities, relationships, attributes
        if (m = line.match(/^entity\s+(\w+)$/)) entities[m[1]] = { weak: false };
        else if (m = line.match(/^weak entity\s+(\w+)$/)) entities[m[1]] = { weak: true };
        else if (m = line.match(/^relationship\s+(\w+)$/)) relationships[m[1]] = { identifying: false };
        else if (m = line.match(/^identifying relationship\s+(\w+)$/)) relationships[m[1]] = { identifying: true };
        else if (m = line.match(/^attribute\s+(\w+)\s+(\w+)(?:\s+(PK|MULTI|DERIVED))?$/))
            attributes.push({ owner: m[1], name: m[2], type: m[3] || null });
        else if (m = line.match(/^composite\s+(\w+)\s+(\w+)\s*{(.+)}$/))
            composites.push({ owner: m[1], name: m[2], parts: m[3].split(",").map(p => p.trim()) });
        else if (m = line.match(/^(\w+)\s+(\w+)\s+\((1|N|M)\)\s+(TOTAL|PARTIAL)\s+--\s+\((1|N|M)\)\s+(TOTAL|PARTIAL)\s+(\w+)$/))
            edges.push({ rel: m[1], from: m[2], fromCard: m[3], fromPart: m[4], toCard: m[5], toPart: m[6], to: m[7] });
    }

    // -------------------------
    // DOT generation (neato) - CONTROLLED SEPARATION
    // -------------------------
    let dot = `graph ER {
layout=neato;
overlap=true;
splines=true;
K=0.4;
epsilon=0.01;
defaultdist=1.0;

node [fontname="Helvetica", width=1.6, height=0.9];
edge [len=1.5];
`;

    // -------------------------
    // Entities (larger margin for separation)
    // -------------------------
    for (const [name, e] of Object.entries(entities)) {
        const periph = e.weak ? ", peripheries=2" : "";
        const fillColor = e.weak ? weakEntityColor : entityColor;
        dot += `  ${name} [shape=rectangle${periph}, style=filled, fillcolor="${fillColor}", margin="0.3,0.2"];\n`;
    }

    // -------------------------
    // Relationships (larger margin for separation)
    // -------------------------
    for (const [name, r] of Object.entries(relationships)) {
        const periph = r.identifying ? ", peripheries=2" : "";
        dot += `  ${name} [shape=diamond${periph}, style=filled, fillcolor="${relationshipColor}", margin="0.3,0.2"];\n`;
    }

    // Attributes (compact, small nodes)
    for (const a of attributes) {
        let extra = [];
        if (a.type === "MULTI") extra.push("peripheries=2");
        if (a.type === "DERIVED") extra.push("style=dashed");

        const label = a.type === "PK" ? `< <u>${a.name}</u> >` : `"${a.name}"`;
        const node = `${a.owner}_${a.name}`;
        dot += `  ${node} [shape=ellipse, label=${label}, width=0.8, height=0.5, margin="0.1,0.05"${extra.length ? ", " + extra.join(",") : ""}];\n`;
        dot += `  ${a.owner} -- ${node} [len=0.5, weight=50];\n`;
    }

    // -------------------------
    // Composite attributes (compact, small nodes)
    // -------------------------
    for (const c of composites) {
        const root = `${c.owner}_${c.name}`;
        dot += `  ${root} [shape=ellipse, label="${c.name}", width=0.8, height=0.5, margin="0.1,0.05"];\n`;
        dot += `  ${c.owner} -- ${root} [len=0.5, weight=30];\n`;
        for (const p of c.parts) {
            const part = `${root}_${p}`;
            dot += `  ${part} [shape=ellipse, label="${p}", width=0.8, height=0.5, margin="0.1,0.05"];\n`;
            dot += `  ${root} -- ${part} [len=0.5, weight=30];\n`;
        }
    }

    // Relationships (moderate distance)
    for (const e of edges) {
        const fromPen = e.fromPart === "TOTAL" ? 3 : 1;
        const toPen = e.toPart === "TOTAL" ? 3 : 1;
        dot += `  ${e.rel} -- ${e.from} [label="${e.fromCard}", penwidth=${fromPen}, len=0.5, weight=10];\n`;
        dot += `  ${e.rel} -- ${e.to} [label="${e.toCard}", penwidth=${toPen}, len=0.5, weight=10];\n`;
    }

    dot += "}";
    return dot;
}