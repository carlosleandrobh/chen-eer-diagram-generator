// ============================================================================
// Chen ER renderer — custom SVG with exact Chen notation + draggable nodes
// ============================================================================
//
// Why custom SVG instead of Graphviz:
//   General graph-layout engines (Graphviz fdp/neato/dot) don't understand ER
//   semantics, so for a complex schema they either tangle (force-directed) or
//   look like an org-chart (hierarchical).  Here we split the problem the way
//   the domain wants:
//     • BACKBONE (entities + relationships, a sparse graph) gets a small
//       force layout — few nodes, easy to read, and the user drags to perfect.
//     • ATTRIBUTES are placed DETERMINISTICALLY in a fan around their owner,
//       on the side away from the backbone.  They can never tangle with other
//       owners' attributes, which was the core failure of the Graphviz output.
//   SVG gives full Chen-notation fidelity: PK underline, double ovals/diamonds,
//   double participation lines — none of which survive in Graphviz/Cytoscape.
//
//   Nodes are draggable; pan with the background, zoom with the wheel.
// ============================================================================
const ChenDiagram = (function () {
    const NS = "http://www.w3.org/2000/svg";

    // ── tiny SVG element helper ─────────────────────────────────────────────
    function el(tag, attrs, kids) {
        const e = document.createElementNS(NS, tag);
        if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
        if (kids) for (const c of [].concat(kids)) if (c) e.appendChild(c);
        return e;
    }
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const labelWidth = (txt, min, per, pad) =>
        Math.max(min || 64, (txt ? txt.length : 0) * (per || 7.2) + (pad || 22));

    // ── 1. Build a flat node/edge graph from the parsed model ───────────────
    function buildGraph(model) {
        const nodes = [];
        const byId  = {};
        const add = n => { nodes.push(n); byId[n.id] = n; return n; };

        // entities
        for (const name in model.entities)
            add({ id: name, kind: "entity", label: name, weak: model.entities[name].weak,
                  w: Math.max(108, labelWidth(name, 90, 8, 28)), h: 46 });
        // relationships
        for (const name in model.relationships)
            add({ id: name, kind: "relationship", label: name,
                  identifying: model.relationships[name].identifying,
                  w: Math.max(120, labelWidth(name, 110, 8, 44)), h: 64 });

        // attributes
        const childrenOf = {};                       // ownerId -> [childNode]
        const pushChild  = (owner, node) => (childrenOf[owner] ||= []).push(node);

        for (const a of model.attributes) {
            const n = add({ id: `attr:${a.owner}:${a.name}`, kind: "attribute", label: a.name,
                            attrType: a.type, owner: a.owner,
                            w: labelWidth(a.name, 66, 7.2, 22), h: 34 });
            pushChild(a.owner, n);
        }
        // composites: a root ellipse + sub-attribute ellipses
        for (const c of model.composites) {
            const rootId = `comp:${c.owner}:${c.name}`;
            const root = add({ id: rootId, kind: "attribute", label: c.name, attrType: null,
                               owner: c.owner, isComposite: true,
                               w: labelWidth(c.name, 66, 7.2, 22), h: 34 });
            pushChild(c.owner, root);
            root.parts = [];
            for (const p of c.parts) {
                const pn = add({ id: `${rootId}:${p}`, kind: "subattr", label: p, owner: rootId,
                                 w: labelWidth(p, 58, 6.8, 18), h: 30 });
                root.parts.push(pn);
            }
        }

        // edges
        const edges = [];
        for (const a of model.attributes)
            edges.push({ kind: "attr", source: a.owner, target: `attr:${a.owner}:${a.name}` });
        for (const c of model.composites) {
            const rootId = `comp:${c.owner}:${c.name}`;
            edges.push({ kind: "attr", source: c.owner, target: rootId });
            for (const p of c.parts)
                edges.push({ kind: "attr", source: rootId, target: `${rootId}:${p}` });
        }
        // backbone: one edge per (relationship, entity) side, carrying cardinality
        const backbonePairs = [];
        for (const e of model.edges) {
            edges.push({ kind: "backbone", source: e.rel, target: e.from,
                         card: e.fromCard, total: e.fromPart === "TOTAL" });
            edges.push({ kind: "backbone", source: e.rel, target: e.to,
                         card: e.toCard, total: e.toPart === "TOTAL" });
            backbonePairs.push([e.rel, e.from], [e.rel, e.to]);
        }

        return { nodes, byId, edges, childrenOf, backbonePairs };
    }

    // ── 2. Layout ───────────────────────────────────────────────────────────
    function layout(g, opts) {
        const spacing = opts && opts.spacing != null ? opts.spacing : 1;

        // 2a. Backbone = entities + relationships, laid out with Fruchterman–Reingold.
        const bb = g.nodes.filter(n => n.kind === "entity" || n.kind === "relationship");
        const bbSet = new Set(bb.map(n => n.id));
        const K = 165 * spacing;                              // ideal backbone edge length
        // seed on a circle
        const R0 = K * Math.max(1, bb.length) / (2 * Math.PI) + K;
        bb.forEach((n, i) => {
            const a = (2 * Math.PI * i) / bb.length;
            n.x = Math.cos(a) * R0; n.y = Math.sin(a) * R0;
        });
        const adj = g.backbonePairs.filter(([a, b]) => bbSet.has(a) && bbSet.has(b));

        const ITER = 450;
        for (let it = 0; it < ITER; it++) {
            const disp = {};
            bb.forEach(n => (disp[n.id] = { x: 0, y: 0 }));
            // repulsion (all pairs)
            for (let i = 0; i < bb.length; i++)
                for (let j = i + 1; j < bb.length; j++) {
                    const u = bb[i], v = bb[j];
                    let dx = u.x - v.x, dy = u.y - v.y;
                    let d = Math.hypot(dx, dy) || 0.01;
                    const f = (K * K) / d;
                    dx /= d; dy /= d;
                    disp[u.id].x += dx * f; disp[u.id].y += dy * f;
                    disp[v.id].x -= dx * f; disp[v.id].y -= dy * f;
                }
            // attraction (backbone edges)
            for (const [a, b] of adj) {
                const u = g.byId[a], v = g.byId[b];
                let dx = u.x - v.x, dy = u.y - v.y;
                let d = Math.hypot(dx, dy) || 0.01;
                const f = (d * d) / K;
                dx /= d; dy /= d;
                disp[a].x -= dx * f; disp[a].y -= dy * f;
                disp[b].x += dx * f; disp[b].y += dy * f;
            }
            // gravity toward centroid (keeps it compact / connected)
            let cx = 0, cy = 0;
            bb.forEach(n => { cx += n.x; cy += n.y; });
            cx /= bb.length; cy /= bb.length;
            const temp = K * (1 - it / ITER);
            for (const n of bb) {
                disp[n.id].x += (cx - n.x) * 0.03;
                disp[n.id].y += (cy - n.y) * 0.03;
                const dd = Math.hypot(disp[n.id].x, disp[n.id].y) || 0.01;
                n.x += (disp[n.id].x / dd) * Math.min(dd, temp);
                n.y += (disp[n.id].y / dd) * Math.min(dd, temp);
            }
        }

        // 2b. Attributes — deterministic fan around each owner, away from backbone.
        const neighborDir = (owner) => {
            // average unit vector toward this owner's backbone neighbours
            let vx = 0, vy = 0, cnt = 0;
            for (const [a, b] of adj) {
                let other = a === owner.id ? b : (b === owner.id ? a : null);
                if (!other) continue;
                const o = g.byId[other];
                const dx = o.x - owner.x, dy = o.y - owner.y, d = Math.hypot(dx, dy) || 1;
                vx += dx / d; vy += dy / d; cnt++;
            }
            return cnt ? { x: vx, y: vy } : null;
        };

        const placeFan = (centerNode, kids, baseAngle, arc, radius) => {
            const n = kids.length;
            kids.forEach((kid, i) => {
                const t = n === 1 ? 0 : (i / (n - 1)) - 0.5;   // -0.5 .. 0.5
                const ang = baseAngle + t * arc;
                kid.x = centerNode.x + Math.cos(ang) * radius;
                kid.y = centerNode.y + Math.sin(ang) * radius;
                kid._angle = ang;
            });
        };

        for (const owner of bb) {
            const kids = g.childrenOf[owner.id];
            if (!kids || !kids.length) continue;
            const nd = neighborDir(owner);
            // point attributes away from the backbone connections
            const base = nd ? Math.atan2(nd.y, nd.x) + Math.PI : -Math.PI / 2;
            const arc  = kids.length <= 1 ? 0 : Math.min(2 * Math.PI * 0.95, 0.62 * Math.PI * kids.length);
            const attrW = 84;
            const radius = Math.max(owner.h / 2 + 64 * spacing,
                                    (kids.length * attrW) / (arc || Math.PI) + 40);
            placeFan(owner, kids, base, arc, radius);

            // sub-attributes fan out beyond each composite root, continuing outward
            for (const kid of kids) {
                if (!kid.parts || !kid.parts.length) continue;
                const outward = kid._angle != null ? kid._angle : base;
                placeFan(kid, kid.parts, outward,
                         Math.min(Math.PI, 0.5 * Math.PI + 0.12 * kid.parts.length),
                         kid.h / 2 + 60 * spacing);
            }
        }

        // 2c. translate everything so min corner is at a small margin
        let minx = Infinity, miny = Infinity;
        for (const n of g.nodes) { minx = Math.min(minx, n.x - n.w / 2); miny = Math.min(miny, n.y - n.h / 2); }
        const ox = 40 - minx, oy = 40 - miny;
        for (const n of g.nodes) { n.x += ox; n.y += oy; }
    }

    // ── 3. Node drawing (Chen notation) ─────────────────────────────────────
    function drawLabel(n, extra) {
        const a = { "text-anchor": "middle", "dominant-baseline": "central",
                    "font-family": "Helvetica, Arial, sans-serif", "font-size": 12, fill: "#1a1a1a" };
        if (extra) Object.assign(a, extra);
        const t = el("text", a);
        t.textContent = n.label;
        return t;
    }

    function drawNode(n, colors) {
        const g = el("g", { class: "node", "data-id": n.id, transform: `translate(${n.x},${n.y})`,
                            cursor: "grab" });
        const stroke = "#33373d";

        if (n.kind === "entity") {
            const w = n.w, h = n.h, fill = n.weak ? colors.weak : colors.entity;
            g.appendChild(el("rect", { x: -w/2, y: -h/2, width: w, height: h, rx: 2,
                                       fill, stroke, "stroke-width": 1.4 }));
            if (n.weak)
                g.appendChild(el("rect", { x: -w/2+4, y: -h/2+4, width: w-8, height: h-8, rx: 1,
                                           fill: "none", stroke, "stroke-width": 1.2 }));
            g.appendChild(drawLabel(n, { "font-weight": 600 }));

        } else if (n.kind === "relationship") {
            const w = n.w, h = n.h, fill = colors.relationship;
            const dia = (iw, ih) => `0,${-ih/2} ${iw/2},0 0,${ih/2} ${-iw/2},0`;
            g.appendChild(el("polygon", { points: dia(w, h), fill, stroke, "stroke-width": 1.4 }));
            if (n.identifying)
                g.appendChild(el("polygon", { points: dia(w-10, h-10), fill: "none", stroke, "stroke-width": 1.2 }));
            g.appendChild(drawLabel(n, { "font-weight": 600 }));

        } else { // attribute / subattr (ellipse)
            const w = n.w, h = n.h, rx = w/2, ry = h/2;
            const dashed = n.attrType === "DERIVED";
            const base = { cx: 0, cy: 0, rx, ry, fill: "#ffffff", stroke, "stroke-width": 1.2 };
            if (dashed) base["stroke-dasharray"] = "5,3";
            g.appendChild(el("ellipse", base));
            if (n.attrType === "MULTI")
                g.appendChild(el("ellipse", { cx: 0, cy: 0, rx: rx-4, ry: ry-4,
                                              fill: "none", stroke, "stroke-width": 1 }));
            const lab = n.attrType === "PK"
                ? drawLabel(n, { "text-decoration": "underline", "font-size": 11.5 })
                : drawLabel(n, { "font-size": n.kind === "subattr" ? 11 : 11.5 });
            g.appendChild(lab);
        }
        return g;
    }

    // ── 4. Edge drawing + update ────────────────────────────────────────────
    function makeEdge(edge, byId) {
        const u = byId[edge.source], v = byId[edge.target];
        const grp = el("g", { class: "edge" });
        const parts = {};

        if (edge.kind === "backbone") {
            parts.l1 = el("line", { stroke: "#33373d", "stroke-width": 1.4 });
            grp.appendChild(parts.l1);
            if (edge.total) { parts.l2 = el("line", { stroke: "#33373d", "stroke-width": 1.4 }); grp.appendChild(parts.l2); }
            if (edge.card) {
                parts.box  = el("rect", { width: 18, height: 16, rx: 2, fill: "#ffffff", stroke: "none" });
                parts.txt  = el("text", { "text-anchor": "middle", "dominant-baseline": "central",
                                          "font-family": "Helvetica, Arial, sans-serif", "font-size": 11, fill: "#1a1a1a" });
                parts.txt.textContent = edge.card;
                grp.appendChild(parts.box); grp.appendChild(parts.txt);
            }
        } else {
            parts.l1 = el("line", { stroke: "#33373d", "stroke-width": 1.1 });
            grp.appendChild(parts.l1);
        }

        const update = () => {
            const x1 = u.x, y1 = u.y, x2 = v.x, y2 = v.y;
            if (edge.kind === "backbone" && edge.total) {
                let dx = x2 - x1, dy = y2 - y1, d = Math.hypot(dx, dy) || 1;
                const px = -dy / d * 2.4, py = dx / d * 2.4;
                parts.l1.setAttribute("x1", x1+px); parts.l1.setAttribute("y1", y1+py);
                parts.l1.setAttribute("x2", x2+px); parts.l1.setAttribute("y2", y2+py);
                parts.l2.setAttribute("x1", x1-px); parts.l2.setAttribute("y1", y1-py);
                parts.l2.setAttribute("x2", x2-px); parts.l2.setAttribute("y2", y2-py);
            } else {
                parts.l1.setAttribute("x1", x1); parts.l1.setAttribute("y1", y1);
                parts.l1.setAttribute("x2", x2); parts.l1.setAttribute("y2", y2);
            }
            if (parts.box) {
                const t = 0.66;                       // cardinality sits ~2/3 toward the entity
                const cx = x1 + (x2 - x1) * t, cy = y1 + (y2 - y1) * t;
                parts.box.setAttribute("x", cx - 9); parts.box.setAttribute("y", cy - 8);
                parts.txt.setAttribute("x", cx);     parts.txt.setAttribute("y", cy);
            }
        };
        update();
        return { grp, update, u, v };
    }

    // ── 5. Render + interaction ─────────────────────────────────────────────
    function render(container, model, opts) {
        const g = buildGraph(model);
        layout(g, opts);

        const svg      = el("svg", { width: "100%", height: "100%" });
        const viewport = el("g", { class: "viewport" });
        const edgeLayer = el("g", { class: "edges" });
        const nodeLayer = el("g", { class: "nodes" });
        viewport.appendChild(edgeLayer); viewport.appendChild(nodeLayer);
        svg.appendChild(viewport);

        // edges (under nodes)
        const edgesByNode = {};                       // nodeId -> [edgeObj]
        for (const e of g.edges) {
            const eo = makeEdge(e, g.byId);
            edgeLayer.appendChild(eo.grp);
            (edgesByNode[e.source] ||= []).push(eo);
            (edgesByNode[e.target] ||= []).push(eo);
        }
        // nodes
        const elByNode = {};
        for (const n of g.nodes) { const ne = drawNode(n, model.colors); nodeLayer.appendChild(ne); elByNode[n.id] = ne; }

        container.innerHTML = "";
        container.appendChild(svg);

        // view transform
        const view = { x: 0, y: 0, k: 1 };
        const applyView = () => viewport.setAttribute("transform", `translate(${view.x},${view.y}) scale(${view.k})`);

        const contentBBox = () => {
            let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
            for (const n of g.nodes) { a = Math.min(a, n.x-n.w/2); b = Math.min(b, n.y-n.h/2);
                                       c = Math.max(c, n.x+n.w/2); d = Math.max(d, n.y+n.h/2); }
            return { x: a, y: b, w: c-a, h: d-b };
        };
        const fit = () => {
            const bb = contentBBox(), rect = container.getBoundingClientRect();
            const m = 30;
            view.k = clamp(Math.min((rect.width-2*m)/bb.w, (rect.height-2*m)/bb.h), 0.05, 3);
            view.x = (rect.width  - bb.w*view.k)/2 - bb.x*view.k;
            view.y = (rect.height - bb.h*view.k)/2 - bb.y*view.k;
            applyView();
        };

        // ── pan / zoom / drag ────────────────────────────────────────────────
        let drag = null, pan = null;
        const localPt = (clientX, clientY) => {
            const r = svg.getBoundingClientRect();
            return { x: (clientX - r.left - view.x) / view.k, y: (clientY - r.top - view.y) / view.k };
        };
        const refreshNode = n => {
            elByNode[n.id].setAttribute("transform", `translate(${n.x},${n.y})`);
            (edgesByNode[n.id] || []).forEach(eo => eo.update());
        };

        nodeLayer.addEventListener("pointerdown", ev => {
            const ng = ev.target.closest(".node"); if (!ng) return;
            ev.preventDefault(); ev.stopPropagation();
            const n = g.byId[ng.getAttribute("data-id")];
            const p = localPt(ev.clientX, ev.clientY);
            drag = { n, dx: n.x - p.x, dy: n.y - p.y };
            ng.setAttribute("cursor", "grabbing");
            svg.setPointerCapture(ev.pointerId);
        });
        svg.addEventListener("pointerdown", ev => {
            if (drag) return;
            pan = { x: ev.clientX, y: ev.clientY, vx: view.x, vy: view.y };
            svg.setPointerCapture(ev.pointerId); svg.style.cursor = "move";
        });
        svg.addEventListener("pointermove", ev => {
            if (drag) {
                const p = localPt(ev.clientX, ev.clientY);
                drag.n.x = p.x + drag.dx; drag.n.y = p.y + drag.dy;
                refreshNode(drag.n);
            } else if (pan) {
                view.x = pan.vx + (ev.clientX - pan.x);
                view.y = pan.vy + (ev.clientY - pan.y);
                applyView();
            }
        });
        const endPointer = () => {
            if (drag) elByNode[drag.n.id].setAttribute("cursor", "grab");
            drag = null; pan = null; svg.style.cursor = "";
        };
        svg.addEventListener("pointerup", endPointer);
        svg.addEventListener("pointercancel", endPointer);

        svg.addEventListener("wheel", ev => {
            ev.preventDefault();
            const r = svg.getBoundingClientRect();
            const mx = ev.clientX - r.left, my = ev.clientY - r.top;
            const factor = ev.deltaY < 0 ? 1.12 : 1/1.12;
            const nk = clamp(view.k * factor, 0.05, 6);
            view.x = mx - (mx - view.x) * (nk / view.k);
            view.y = my - (my - view.y) * (nk / view.k);
            view.k = nk; applyView();
        }, { passive: false });

        requestAnimationFrame(fit);

        // ── export: standalone SVG sized to content, no view transform ───────
        const getSVGString = () => {
            const bb = contentBBox(), m = 20;
            const out = el("svg", {
                xmlns: NS, viewBox: `${bb.x-m} ${bb.y-m} ${bb.w+2*m} ${bb.h+2*m}`,
                width: bb.w + 2*m, height: bb.h + 2*m,
            });
            out.appendChild(el("rect", { x: bb.x-m, y: bb.y-m, width: bb.w+2*m, height: bb.h+2*m, fill: "#ffffff" }));
            out.appendChild(edgeLayer.cloneNode(true));
            out.appendChild(nodeLayer.cloneNode(true));
            return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(out);
        };

        return { svg, fit, getSVGString };
    }

    return { render };
})();

if (typeof module !== "undefined" && module.exports) module.exports = { ChenDiagram };
