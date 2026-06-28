// ================================
// Chen ER DSL Parser → model object
// ================================
// The parser only understands the DSL.  It returns a plain data model;
// layout + rendering live in chen-render.js (custom Chen-notation SVG).
function parseDSL(dsl) {
    const lines = dsl
        .split("\n")
        .map(l => l.trim())
        .filter(l => l);

    const entities      = {};   // name -> { weak }
    const relationships = {};   // name -> { identifying }
    const attributes    = [];   // { owner, name, type }
    const composites    = [];   // { owner, name, parts[] }
    const edges         = [];   // { rel, from, fromCard, fromPart, toCard, toPart, to }

    const colors = {
        entity:       "#AED6F1",
        weak:         "#D6EAF8",
        relationship: "#FFE4B5",
    };

    for (const line of lines) {
        if (line.startsWith("#") || line === "") continue;

        let m;
        if (m = line.match(/^entities\s*:\s*(#[0-9A-Fa-f]{3,6})$/))      { colors.entity       = m[1]; continue; }
        if (m = line.match(/^weak_entities\s*:\s*(#[0-9A-Fa-f]{3,6})$/)) { colors.weak         = m[1]; continue; }
        if (m = line.match(/^relationships\s*:\s*(#[0-9A-Fa-f]{3,6})$/)) { colors.relationship = m[1]; continue; }

        if      (m = line.match(/^entity\s+(\w+)$/))                   entities[m[1]]      = { weak: false };
        else if (m = line.match(/^weak entity\s+(\w+)$/))             entities[m[1]]      = { weak: true  };
        else if (m = line.match(/^relationship\s+(\w+)$/))            relationships[m[1]] = { identifying: false };
        else if (m = line.match(/^identifying relationship\s+(\w+)$/)) relationships[m[1]] = { identifying: true  };
        else if (m = line.match(/^attribute\s+(\w+)\s+(\w+)(?:\s+(PK|MULTI|DERIVED))?$/))
            attributes.push({ owner: m[1], name: m[2], type: m[3] || null });
        else if (m = line.match(/^composite\s+(\w+)\s+(\w+)\s*{(.+)}$/))
            composites.push({ owner: m[1], name: m[2], parts: m[3].split(",").map(p => p.trim()).filter(Boolean) });
        else if (m = line.match(/^(\w+)\s+(\w+)\s+\((1|N|M)\)\s+(TOTAL|PARTIAL)\s+--\s+\((1|N|M)\)\s+(TOTAL|PARTIAL)\s+(\w+)$/))
            edges.push({ rel: m[1], from: m[2], fromCard: m[3], fromPart: m[4], toCard: m[5], toPart: m[6], to: m[7] });
    }

    return { colors, entities, relationships, attributes, composites, edges };
}

// Allow use under Node for testing.
if (typeof module !== "undefined" && module.exports) module.exports = { parseDSL };
