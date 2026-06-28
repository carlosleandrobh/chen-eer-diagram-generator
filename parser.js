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

    // -------------------------
    // Default colors
    // -------------------------
    let entityColor       = "#AED6F1";   // light blue
    let weakEntityColor   = "#D6EAF8";   // lighter blue
    let relationshipColor = "#FFE4B5";   // light orange/yellow

    // -------------------------
    // Parse DSL
    // -------------------------
    for (const line of lines) {
        if (line.startsWith("#") || line === "") continue;

        let m;

        // Color config
        if (m = line.match(/^entities\s*:\s*(#[0-9A-Fa-f]{3,6})$/))      { entityColor       = m[1]; continue; }
        if (m = line.match(/^weak_entities\s*:\s*(#[0-9A-Fa-f]{3,6})$/)) { weakEntityColor   = m[1]; continue; }
        if (m = line.match(/^relationships\s*:\s*(#[0-9A-Fa-f]{3,6})$/)) { relationshipColor = m[1]; continue; }

        // Entities
        if      (m = line.match(/^entity\s+(\w+)$/))          entities[m[1]] = { weak: false };
        else if (m = line.match(/^weak entity\s+(\w+)$/))     entities[m[1]] = { weak: true  };
        // Relationships
        else if (m = line.match(/^relationship\s+(\w+)$/))             relationships[m[1]] = { identifying: false };
        else if (m = line.match(/^identifying relationship\s+(\w+)$/)) relationships[m[1]] = { identifying: true  };
        // Attributes
        else if (m = line.match(/^attribute\s+(\w+)\s+(\w+)(?:\s+(PK|MULTI|DERIVED))?$/))
            attributes.push({ owner: m[1], name: m[2], type: m[3] || null });
        // Composite attributes
        else if (m = line.match(/^composite\s+(\w+)\s+(\w+)\s*{(.+)}$/))
            composites.push({ owner: m[1], name: m[2], parts: m[3].split(",").map(p => p.trim()) });
        // Relationship edges  (e.g.  Enrolls Student (1) TOTAL -- (N) PARTIAL Course)
        else if (m = line.match(/^(\w+)\s+(\w+)\s+\((1|N|M)\)\s+(TOTAL|PARTIAL)\s+--\s+\((1|N|M)\)\s+(TOTAL|PARTIAL)\s+(\w+)$/))
            edges.push({ rel: m[1], from: m[2], fromCard: m[3], fromPart: m[4], toCard: m[5], toPart: m[6], to: m[7] });
    }

    // ─────────────────────────────────────────────────────────────────
    // DOT generation
    //
    // Engine: fdp  (force-directed placement)
    //   • K controls the ideal spring distance between unconnected nodes
    //   • overlap=false runs the Prism/VPSC algorithm to remove overlaps
    //     without uniformly scaling the whole graph (unlike overlap=scale)
    //   • sep adds an extra safety margin around each node for the
    //     overlap-removal step
    //   • Edges use `weight` to pull attributes close to their owners and
    //     keep relationship diamonds near their entity boxes
    // ─────────────────────────────────────────────────────────────────
    let dot = `graph ER {
  layout=fdp;
  K=2.2;
  overlap=false;
  sep="+14";
  splines=true;
  nodesep=0.5;

  node [fontname="Helvetica", fontsize=11];
  edge [fontname="Helvetica", fontsize=10];
`;

    // ── Entities ──────────────────────────────────────────────────────
    for (const [name, e] of Object.entries(entities)) {
        const periph    = e.weak ? ", peripheries=2" : "";
        const fillColor = e.weak ? weakEntityColor : entityColor;
        dot += `  ${name} [shape=rectangle${periph}, style=filled, fillcolor="${fillColor}", ` +
               `margin="0.25,0.12", width=1.4, height=0.55];\n`;
    }

    // ── Relationships ─────────────────────────────────────────────────
    for (const [name, r] of Object.entries(relationships)) {
        const periph = r.identifying ? ", peripheries=2" : "";
        dot += `  ${name} [shape=diamond${periph}, style=filled, fillcolor="${relationshipColor}", ` +
               `margin="0.3,0.15", width=1.5, height=0.9];\n`;
    }

    // ── Attributes ────────────────────────────────────────────────────
    // High edge weight keeps attribute satellites tightly orbiting their owner.
    for (const a of attributes) {
        const extra = [];
        if (a.type === "MULTI")   extra.push("peripheries=2");
        if (a.type === "DERIVED") extra.push("style=dashed");

        const label    = a.type === "PK" ? `< <u>${a.name}</u> >` : `"${a.name}"`;
        const nodeId   = `${a.owner}_${a.name}`;
        const extraStr = extra.length ? `, ${extra.join(",")}` : "";

        dot += `  ${nodeId} [shape=ellipse, label=${label}, width=0.85, height=0.45, margin="0.08,0.04"${extraStr}];\n`;
        dot += `  ${a.owner} -- ${nodeId} [weight=8, style=solid];\n`;
    }

    // ── Composite attributes ──────────────────────────────────────────
    for (const c of composites) {
        const rootId = `${c.owner}_${c.name}`;
        dot += `  ${rootId} [shape=ellipse, label="${c.name}", width=0.85, height=0.45, margin="0.08,0.04"];\n`;
        dot += `  ${c.owner} -- ${rootId} [weight=8, style=solid];\n`;
        for (const p of c.parts) {
            const partId = `${rootId}_${p}`;
            dot += `  ${partId} [shape=ellipse, label="${p}", width=0.8, height=0.4, margin="0.06,0.03"];\n`;
            dot += `  ${rootId} -- ${partId} [weight=12, style=solid];\n`;
        }
    }

    // ── Relationship–entity connections ───────────────────────────────
    for (const e of edges) {
        const fromPen = e.fromPart === "TOTAL" ? 2.5 : 1;
        const toPen   = e.toPart   === "TOTAL" ? 2.5 : 1;
        dot += `  ${e.rel} -- ${e.from} [label="${e.fromCard}", penwidth=${fromPen}, weight=3];\n`;
        dot += `  ${e.rel} -- ${e.to}   [label="${e.toCard}",   penwidth=${toPen},   weight=3];\n`;
    }

    dot += "}";
    return dot;
}