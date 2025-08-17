import React, { useState, useEffect } from "react";
import { Network } from "vis-network";
import Papa from "papaparse";

// Configuration par défaut (sera surchargée si un JSON externe est présent dans /public)
const defaultConfig = {
  hierarchy: [
    "amour",
    "meilleur ami",
    "ami ++",
    "ami",
    "entre ami et neutre",
    "neutre",
    "entre neutre et haine",
    "haine",
    "dégoût",
    "famille",
    "famille conjoint",
    "connaît pas"
  ],
  colors: {
    "amour": "#FF00DC",
    "meilleur ami": "#0026FF",
    "ami ++": "#5A8CFF",
    "ami": "#00AA00",
    "entre ami et neutre": "#AAAA00",
    "neutre": "#808080",
    "entre neutre et haine": "#FF8800",
    "haine": "#FF0000",
    "dégoût": "#A80000",
    "famille": "#00FFD0",
    "famille conjoint": "#00FFF0",
    "connaît pas": "#C0C0C0"
  },
  // vide par défaut: pas de fusion de synonymes tant qu'un fichier externe ne fournit pas relationGroups
  relationGroups: {}
};

function buildNormalizationMap(relationGroups) {
  return Object.entries(relationGroups).reduce((acc, [canon, variants]) => {
    variants.forEach(v => { acc[v.toLowerCase()] = canon; });
    return acc;
  }, {});
}

function strongerRelation(r1, r2, hierarchy) {
  if (!r1) return r2;
  if (!r2) return r1;
  const i1 = hierarchy.indexOf(r1);
  const i2 = hierarchy.indexOf(r2);
  if (i1 === -1 && i2 === -1) return r1;
  if (i1 === -1) return r2;
  if (i2 === -1) return r1;
  return (i1 < i2) ? r1 : r2;
}

function cleanHeader(header) {
  // Nettoie les noms de colonnes pour extraire les personnes
  return header.map(h => {
    // Si c'est une colonne de relation, on extrait le nom cible
    if (/Votre relation vis-à-vis de/i.test(h)) {
      // Supprime tout ce qui précède le nom, les retours à la ligne, les guillemets, les espaces
      return h.replace(/Votre relation vis-à-vis de\s*:?/i, "")
              .replace(/\n/g, " ")
              .replace(/\r/g, " ")
              .replace(/"/g, "")
              .replace(/\s+/g, " ")
              .trim();
    }
    return h.replace(/"/g, "").trim();
  });
}

function parseCSV(csvText, cfg) {
  const { hierarchy, colors, relationGroups } = cfg;
  const normalizationMap = buildNormalizationMap(relationGroups);
  function normalizeRelation(rel) {
    if (!rel) return null;
    const key = rel.trim().toLowerCase();
    return normalizationMap[key] || key;
  }
  const result = Papa.parse(csvText, { header: true, skipEmptyLines: true });
  const data = result.data;
  const rawHeader = result.meta.fields;
  const header = cleanHeader(rawHeader);
  const nodes = new Set();
  // Maps pour les deux modes
  const mergedEdgeMap = {}; // key -> normalized label (plus forte)
  const rawEdgeMap = {}; // key -> { raw, norm }

  data.forEach(row => {
    const source = row[header[1]]?.trim();
    if (!source) return;
    nodes.add(source);
    for (let j = 2; j < header.length; j++) {
      const target = header[j];
      if (!target || source === target) continue;
      nodes.add(target);
      const cellValue = row[rawHeader[j]];
      if (!cellValue) continue;
      const rawLabel = (cellValue || "").trim();
      if (!rawLabel) continue;
      const normalized = normalizeRelation(rawLabel);
      if (!normalized) continue;
      const key = `${source}|${target}`;
      // Mode fusionné (on garde la plus forte relation normalisée)
      mergedEdgeMap[key] = strongerRelation(mergedEdgeMap[key], normalized, hierarchy);
      // Mode brut : on conserve le libellé original, mais si plusieurs réponses pour la même paire
      // on remplace seulement si la nouvelle relation normalisée est plus forte.
      if (!rawEdgeMap[key]) {
        rawEdgeMap[key] = { raw: rawLabel, norm: normalized };
      } else {
        const currentNorm = rawEdgeMap[key].norm;
        const stronger = strongerRelation(currentNorm, normalized, hierarchy);
        if (stronger !== currentNorm) {
          rawEdgeMap[key] = { raw: rawLabel, norm: normalized };
        }
      }
    }
  });

  // Génère les arêtes fusionnées
  const edgesMerged = Object.entries(mergedEdgeMap).map(([key, rel]) => {
    const [from, to] = key.split("|");
    return {
      from,
      to,
      label: rel,
      color: { color: colors[rel] || "#808080" }
    };
  });
  // Génère les arêtes brutes (label original, couleur issue de la version normalisée)
  const edgesRaw = Object.entries(rawEdgeMap).map(([key, obj]) => {
    const [from, to] = key.split("|");
    return {
      from,
      to,
      label: obj.raw,
      color: { color: colors[obj.norm] || "#808080" }
    };
  });

  return {
    nodes: Array.from(nodes).map(id => ({ id, label: id })),
    edgesMerged,
    edgesRaw,
    // compat pour l'ancien code
    edges: edgesMerged
  };
}

export default function App() {
  const [network, setNetwork] = useState(null);
  const [graph, setGraph] = useState({ nodes: [], edgesMerged: [], edgesRaw: [], edges: [] });
  const [filterPerson, setFilterPerson] = useState([]);
  const [filterRelation, setFilterRelation] = useState([]);
  const [useMerged, setUseMerged] = useState(true); // true = catégories fusionnées
  const [error, setError] = useState("");
  const [pngScale, setPngScale] = useState(2);
  const [config, setConfig] = useState(defaultConfig);

  // Charge config externe (non commit) si présente
  useEffect(() => {
    let cancelled = false;
    async function loadConfig() {
      const candidates = [
        'relation-config.json'
      ];
      for (const path of candidates) {
        try {
          const resp = await fetch(path, { cache: 'no-store' });
          if (!resp.ok) continue;
          const json = await resp.json();
          if (!cancelled) {
            // merge superficielle
            setConfig(prev => ({
              hierarchy: json.hierarchy || prev.hierarchy,
              colors: json.colors || prev.colors,
              relationGroups: json.relationGroups || prev.relationGroups
            }));
          }
          break;
        } catch (_) { /* ignore */ }
      }
    }
    loadConfig();
    return () => { cancelled = true; };
  }, []);

  function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    setError("");
    const reader = new FileReader();
    reader.onload = evt => {
      const csv = evt.target.result;
      let g;
      try {
        g = parseCSV(csv, config);
      } catch (err) {
        setError("Erreur lors de la lecture du CSV. Format non reconnu.");
        setGraph({ nodes: [], edges: [] });
        if (network) network.destroy();
        return;
      }
      if (!g.nodes.length || (!g.edgesMerged.length && !g.edgesRaw.length)) {
        setError("Aucune donnée trouvée dans le CSV.");
        setGraph({ nodes: [], edges: [] });
        if (network) network.destroy();
        return;
      }
      setGraph(g);
      setTimeout(() => {
        // Réinitialise le conteneur
        const container = document.getElementById("network");
        if (container) container.innerHTML = "";
        if (network) network.destroy();
        // Calcul du rayon en fonction du nombre de nodes
        const nodeCount = g.nodes.length;
        const radius = Math.max(250, nodeCount * 25);
        // Positionne les nodes en cercle
        const angleStep = (2 * Math.PI) / nodeCount;
        g.nodes.forEach((node, i) => {
          node.x = Math.cos(i * angleStep) * radius;
          node.y = Math.sin(i * angleStep) * radius;
        });
        const initialEdges = useMerged ? g.edgesMerged : g.edgesRaw;
        const net = new Network(container, { nodes: g.nodes, edges: initialEdges }, {
          edges: { arrows: "to" },
          layout: {
            improvedLayout: false,
            hierarchical: false
          },
          physics: {
            enabled: false
          }
        });
        setNetwork(net);
      }, 100);
    };
    reader.readAsText(file);
  }

  // Applique le filtre et le layout à chaque changement de filtre ou de graphe
  useEffect(() => {
    let nodes = graph.nodes;
    const baseEdges = useMerged ? graph.edgesMerged : graph.edgesRaw;
    let edges = baseEdges;
    // Filtre personnes : garder uniquement les arêtes dont l'origine (from) est sélectionnée
    if (filterPerson.length > 0) {
      edges = edges.filter(e => filterPerson.includes(e.from));
      const allowedNodeIds = new Set();
      edges.forEach(e => { allowedNodeIds.add(e.from); allowedNodeIds.add(e.to); });
      nodes = nodes.filter(n => allowedNodeIds.has(n.id));
    }
    // Filtre multiple relations (ne filtre que les arêtes, pas les nœuds)
    if (filterRelation.length > 0) {
      edges = edges.filter(e => filterRelation.includes(e.label));
      // nodes restent inchangés
    }
    if (network) {
      const nodeCount = nodes.length;
      const radius = Math.max(250, nodeCount * 25);
      const angleStep = (2 * Math.PI) / nodeCount;
      nodes.forEach((node, i) => {
        node.x = Math.cos(i * angleStep) * radius;
        node.y = Math.sin(i * angleStep) * radius;
      });
      network.setData({ nodes, edges });
    }
  }, [filterPerson, filterRelation, graph, network, useMerged, config]);

  // Export PNG haute résolution
  function exportPNG() {
    if (!network) return;
    try {
      const canvas = network.canvas.frame.canvas; // canvas interne vis-network
      const scale = Math.max(1, Math.min(10, pngScale));
      const ts = new Date().toISOString().replace(/[:T]/g,'-').split('.')[0];
      if (scale === 1) {
        // Fond blanc si transparent
        const off = document.createElement('canvas');
        off.width = canvas.width; off.height = canvas.height;
        const ctx = off.getContext('2d');
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0,0,off.width,off.height);
        ctx.drawImage(canvas,0,0);
        const url = off.toDataURL('image/png');
        triggerDownload(url, `graph_${ts}.png`);
        return;
      }
      const off = document.createElement('canvas');
      off.width = canvas.width * scale;
      off.height = canvas.height * scale;
      const ctx = off.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0,0,off.width,off.height);
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0, off.width, off.height);
        const url2 = off.toDataURL('image/png');
        triggerDownload(url2, `graph_x${scale}_${ts}.png`);
      };
      img.src = canvas.toDataURL('image/png');
    } catch (e) {
      console.error(e);
      setError('Erreur export PNG');
    }
  }

  // Génère un SVG simplifié basé sur les positions courantes
  function exportSVG() {
    if (!network) return;
    try {
      const nodesData = network.body.data.nodes.get();
      const edgesData = network.body.data.edges.get();
      const positions = network.getPositions(nodesData.map(n => n.id));
      // Détermine bounding box
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      nodesData.forEach(n => {
        const p = positions[n.id];
        if (!p) return;
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      });
      const margin = 60;
      const width = (maxX - minX) + margin * 2 || 800;
      const height = (maxY - minY) + margin * 2 || 600;
      const nodeRadius = 22;
      // Construit defs pour flèche
      let svg = [];
      svg.push(`<?xml version="1.0" encoding="UTF-8"?>`);
      svg.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Arial, sans-serif">`);
      svg.push(`<defs><marker id="arrowhead" markerWidth="12" markerHeight="12" refX="10" refY="6" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L12,6 L0,12 z" fill="#555" /></marker></defs>`);
      // Arêtes
      edgesData.forEach(e => {
        const fromP = positions[e.from];
        const toP = positions[e.to];
        if (!fromP || !toP) return;
        const sx = (fromP.x - minX) + margin;
        const sy = (fromP.y - minY) + margin;
        const tx = (toP.x - minX) + margin;
        const ty = (toP.y - minY) + margin;
        const color = (e.color && e.color.color) || '#999';
        svg.push(`<line x1="${sx}" y1="${sy}" x2="${tx}" y2="${ty}" stroke="${color}" stroke-width="2" marker-end="url(#arrowhead)" />`);
        if (e.label) {
          const mx = (sx + tx) / 2;
            const my = (sy + ty) / 2 - 4; // léger offset
            svg.push(`<text x="${mx}" y="${my}" font-size="14" text-anchor="middle" fill="${color}">${escapeXML(e.label)}</text>`);
        }
      });
      // Nœuds
      nodesData.forEach(n => {
        const p = positions[n.id];
        if (!p) return;
        const x = (p.x - minX) + margin;
        const y = (p.y - minY) + margin;
        svg.push(`<circle cx="${x}" cy="${y}" r="${nodeRadius}" fill="#ffffff" stroke="#333" stroke-width="2" />`);
        const label = n.label || n.id;
        svg.push(`<text x="${x}" y="${y+5}" font-size="12" text-anchor="middle" fill="#111">${escapeXML(label)}</text>`);
      });
      svg.push(`</svg>`);
      const blob = new Blob([svg.join('\n')], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const ts = new Date().toISOString().replace(/[:T]/g,'-').split('.')[0];
      triggerDownload(url, `graph_${ts}.svg`);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) {
      console.error(e);
      setError('Erreur export SVG');
    }
  }

  function escapeXML(str) {
    return String(str).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  }

  function triggerDownload(url, filename) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', padding: 16, boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginBottom: 8 }}>
        <img src="/logo.png" alt="Logo" style={{ height: 48, width: 48, objectFit: 'contain', borderRadius: 8, boxShadow: '0 2px 8px #0002' }} />
        <h2 style={{ margin: 0 }}>Visualiseur de Graphe de Relations</h2>
      </div>
      <div style={{ flex: 1, display: 'flex', alignItems: 'stretch', gap: 20, minHeight: 0 }}>
        {/* Panneau de configuration */}
        <div style={{ width: '25%', minWidth: 260, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 16, overflowY: 'auto', paddingRight: 4 }}>
          <div>
            <input type="file" accept=".csv" onChange={handleFile} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <label style={{ fontWeight: 'bold' }}>Fusionner les catégories</label>
            <input
              type="checkbox"
              checked={useMerged}
              onChange={() => {
                setUseMerged(v => !v);
                setFilterRelation([]); // reset filtre relation car liste change
              }}
            />
          </div>
          <div style={{ fontStyle: 'italic', color: '#555', marginTop: -8 }}>
            {useMerged ? 'Affiche les catégories normalisées' : 'Affiche les catégories brutes originales'}
          </div>
          {error && <div style={{ color: 'red' }}>{error}</div>}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <label style={{ marginBottom: 8, fontWeight: 'bold' }}>Filtrer par personne :</label>
            <select multiple value={filterPerson} onChange={e => {
              const opts = Array.from(e.target.selectedOptions).map(o => o.value);
              setFilterPerson(opts);
            }} style={{ minHeight: 180, fontSize: 14, padding: 8, border: '1px solid #ccc', borderRadius: 6, background: '#fff', color: '#222' }}>
              {[...graph.nodes].sort((a, b) => a.label.localeCompare(b.label)).map(n => (
                <option key={n.id} value={n.id}>{n.label}</option>
              ))}
            </select>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <label style={{ marginBottom: 8, fontWeight: 'bold' }}>Filtrer par relation :</label>
            <select multiple value={filterRelation} onChange={e => {
              const opts = Array.from(e.target.selectedOptions).map(o => o.value);
              setFilterRelation(opts);
            }} style={{ minHeight: 180, fontSize: 14, padding: 8, border: '1px solid #ccc', borderRadius: 6, background: '#fff', color: '#222' }}>
              {useMerged ? (
                config.hierarchy.filter(l => (graph.edgesMerged || []).some(e => e.label === l)).map(l => (
                  <option key={l} value={l}>{l}</option>
                ))
              ) : (
                Array.from(new Set((graph.edgesRaw || []).map(e => e.label)))
                  .sort((a,b)=> a.localeCompare(b, 'fr', { sensitivity: 'base' }))
                  .map(l => (
                    <option key={l} value={l}>{l}</option>
                  ))
              )}
            </select>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label style={{ fontWeight: 'bold' }}>Export :</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button onClick={exportSVG} style={{ padding: '6px 12px' }}>Export SVG</button>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <select value={pngScale} onChange={e => setPngScale(Number(e.target.value))} style={{ padding: 4 }}>
                  {[1,2,3,4,5].map(s => <option key={s} value={s}>{s}x</option>)}
                </select>
                <button onClick={exportPNG} style={{ padding: '6px 12px' }}>Export PNG</button>
              </div>
            </div>
            <small style={{ color: '#555' }}>SVG simplifié (formes basiques). PNG utilise un upscale.</small>
          </div>
        </div>
        {/* Zone graphe */}
        <div style={{ width: '75%', boxSizing: 'border-box', flex: 1, minWidth: 0, display: 'flex' }}>
          <div id="network" style={{ flex: 1, border: '1px solid #ccc', width: '100%', height: '100%' }}></div>
        </div>
      </div>
    </div>
  );
}
