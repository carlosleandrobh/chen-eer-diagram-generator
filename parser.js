// ================================
// Chen ER DSL Parser → Graphviz DOT
// ================================
function parseDSL(dsl) {
    const lines = dsl
        .split("\n")
        .map(l => l.trim())
        .filter(l => l);

    const entities      = {};
    const relationships = {};
    const attributes    = [];
    const composites    = [];
    const edges         = [];

    // ── Default colors ─────────────────────────────────────────────────
    let entityColor       = "#AED6F1";
    let weakEntityColor   = "#D6EAF8";
    let relationshipColor = "#FFE4B5";

    // ── Parse DSL ──────────────────────────────────────────────────────
    for (const line of lines) {
        if (line.startsWith("#") || line === "") continue;

        let m;
        if (m = line.match(/^entities\s*:\s*(#[0-9A-Fa-f]{3,6})$/))      { entityColor       = m[1]; continue; }
        if (m = line.match(/^weak_entities\s*:\s*(#[0-9A-Fa-f]{3,6})$/)) { weakEntityColor   = m[1]; continue; }
        if (m = line.match(/^relationships\s*:\s*(#[0-9A-Fa-f]{3,6})$/)) { relationshipColor = m[1]; continue; }

        if      (m = line.match(/^entity\s+(\w+)$/))          entities[m[1]] = { weak: false };
        else if (m = line.match(/^weak entity\s+(\w+)$/))     entities[m[1]] = { weak: true  };
        else if (m = line.match(/^relationship\s+(\w+)$/))             relationships[m[1]] = { identifying: false };
        else if (m = line.match(/^identifying relationship\s+(\w+)$/)) relationships[m[1]] = { identifying: true  };
        else if (m = line.match(/^attribute\s+(\w+)\s+(\w+)(?:\s+(PK|MULTI|DERIVED))?$/))
            attributes.push({ owner: m[1], name: m[2], type: m[3] || null });
        else if (m = line.match(/^composite\s+(\w+)\s+(\w+)\s*{(.+)}$/))
            composites.push({ owner: m[1], name: m[2], parts: m[3].split(",").map(p => p.trim()) });
        else if (m = line.match(/^(\w+)\s+(\w+)\s+\((1|N|M)\)\s+(TOTAL|PARTIAL)\s+--\s+\((1|N|M)\)\s+(TOTAL|PARTIAL)\s+(\w+)$/))
            edges.push({ rel: m[1], from: m[2], fromCard: m[3], fromPart: m[4], toCard: m[5], toPart: m[6], to: m[7] });
    }

    // ──────────────────────────────────────────────────────────────────
    // DOT generation — neato with per-edge ideal lengths
    //
    // Why neato instead of fdp/sfdp:
    //   In neato, the `len` attribute on each edge defines the IDEAL
    //   distance that stress-minimisation tries to achieve.  Setting a
    //   short len for attribute edges keeps them tightly orbiting their
    //   entity, while a longer len for relationship–entity edges gives
    //   the main graph enough breathing room.
    //
    //   sfdp/fdp do NOT honour `len`; they use `weight`, but the
    //   post-processing overlap removal (prism) ignores weights and can
    //   scatter leaf nodes to the corners of the canvas.
    //
    // Overlap strategy:
    //   overlap=false  →  neato's own Prism/Voronoi removal, which
    //   respects the layout structure far better than sfdp's variant.
    //   sep="+6"        →  6 pt of padding between node bounding boxes.
    //
    // Edge lengths:
    //   entity  ↔ attribute       1.4 in   (tight orbit)
    //   entity  ↔ composite-root  1.4 in
    //   composite-root ↔ sub-attr 1.0 in   (even tighter)
    //   rel     ↔ entity          2.4 in   (well-spaced main graph)
    // ──────────────────────────────────────────────────────────────────
    let dot = `graph ER {
  layout=neato;
  mode=major;
  overlap=false;
  sep="+6";
  splines=true;

  node [fontname="Helvetica", fontsize=10, fixedsize=false];
  edge [fontname="Helvetica", fontsize=9];
`;

    // ── Entities ───────────────────────────────────────────────────────
    for (const [name, e] of Object.entries(entities)) {
        const periph    = e.weak ? ", peripheries=2" : "";
        const fillColor = e.weak ? weakEntityColor : entityColor;
        dot += `  ${name} [shape=rectangle${periph}, style=filled, fillcolor="${fillColor}", ` +
               `margin="0.2,0.1", width=1.2, height=0.5];\n`;
    }

    // ── Relationships ──────────────────────────────────────────────────
    for (const [name, r] of Object.entries(relationships)) {
        const periph = r.identifying ? ", peripheries=2" : "";
        dot += `  ${name} [shape=diamond${periph}, style=filled, fillcolor="${relationshipColor}", ` +
               `margin="0.25,0.1", width=1.3, height=0.8];\n`;
    }

    // ── Attributes ─────────────────────────────────────────────────────
    // len=1.4 places each attribute ~1.4 inches from its entity centre.
    // This keeps attributes in a tight ring, independent of graph size.
    for (const a of attributes) {
        const extra = [];
        if (a.type === "MULTI")   extra.push("peripheries=2");
        if (a.type === "DERIVED") extra.push("style=dashed");

        const label    = a.type === "PK" ? `< <u>${a.name}</u> >` : `"${a.name}"`;
        const nodeId   = `${a.owner}_${a.name}`;
        const extraStr = extra.length ? `, ${extra.join(",")}` : "";

        dot += `  ${nodeId} [shape=ellipse, label=${label}, ` +
               `width=0.7, height=0.35, margin="0.06,0.03"${extraStr}];\n`;
        dot += `  ${a.owner} -- ${nodeId} [len=1.4];\n`;
    }

    // ── Composite attributes ───────────────────────────────────────────
    for (const c of composites) {
        const rootId = `${c.owner}_${c.name}`;
        dot += `  ${rootId} [shape=ellipse, label="${c.name}", ` +
               `width=0.7, height=0.35, margin="0.06,0.03"];\n`;
        dot += `  ${c.owner} -- ${rootId} [len=1.4];\n`;
        for (const p of c.parts) {
            const partId = `${rootId}_${p}`;
            dot += `  ${partId} [shape=ellipse, label="${p}", ` +
                   `width=0.65, height=0.32, margin="0.05,0.03"];\n`;
            dot += `  ${rootId} -- ${partId} [len=1.0];\n`;
        }
    }

    // ── Relationship–entity connections ────────────────────────────────
    // len=2.4 gives entities and diamonds plenty of room in the main graph.
    for (const e of edges) {
        const fromPen = e.fromPart === "TOTAL" ? 2.5 : 1;
        const toPen   = e.toPart   === "TOTAL" ? 2.5 : 1;
        dot += `  ${e.rel} -- ${e.from} [label="${e.fromCard}", penwidth=${fromPen}, len=2.4];\n`;
        dot += `  ${e.rel} -- ${e.to}   [label="${e.toCard}",   penwidth=${toPen},   len=2.4];\n`;
    }

    dot += "}";
    return dot;
}