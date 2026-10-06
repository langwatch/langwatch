// Generates the self-hosting architecture diagrams as SVG, one light and one dark file each.
// Usage: node docs/scripts/self-hosting-diagrams.mjs docs/images/self-hosting
// Colour language: orange is LangWatch software, blue is a data store, grey belongs to the
// operator, and a dashed orange line is an optional connection that leaves the install.
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const THEMES = {
  light: {
    bg: "#ffffff",
    ink: "#1d293d",
    soft: "#52637a",
    faint: "#90a1b9",
    line: "#94a3b8",
    zone: "#f8fafc",
    zoneLine: "#cbd5e1",
    cluster: "#f1f5f9",
    clusterLine: "#94a3b8",
    lw: "#fff7ed",
    lwLine: "#f0a04b",
    lwInk: "#9a4a00",
    accent: "#e17100",
    store: "#eff6ff",
    storeLine: "#7ea6e0",
    storeInk: "#1e4b8f",
    own: "#ffffff",
    ownLine: "#94a3b8",
    label: "#ffffff",
    tag: "#fff1e0",
  },
  dark: {
    bg: "#10101a",
    ink: "#f1f5f9",
    soft: "#b4bccb",
    faint: "#7b8394",
    line: "#7b8394",
    zone: "#15151e",
    zoneLine: "#3a3a44",
    cluster: "#1a1a24",
    clusterLine: "#565664",
    lw: "#2a1c0d",
    lwLine: "#c8782a",
    lwInk: "#ffc78a",
    accent: "#ff9d3b",
    store: "#111d33",
    storeLine: "#4a6fae",
    storeInk: "#a9c7f7",
    own: "#20202a",
    ownLine: "#565664",
    label: "#10101a",
    tag: "#3a2a17",
  },
};
const FONT =
  "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const width = (s, size, weight = 400) => s.length * size * (weight >= 600 ? 0.6 : 0.55);

/** The path of a line through the given points, with rounded corners. */
function roundedPath(points) {
  let d = `M${points[0][0]} ${points[0][1]}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i - 1];
    const [x, y] = points[i];
    const [nx, ny] = points[i + 1];
    const r = Math.min(10, Math.hypot(x - px, y - py) / 2, Math.hypot(nx - x, ny - y) / 2);
    const a = [x - Math.sign(x - px) * r, y - Math.sign(y - py) * r];
    const b = [x + Math.sign(nx - x) * r, y + Math.sign(ny - y) * r];
    d += ` L${a[0]} ${a[1]} Q${x} ${y} ${b[0]} ${b[1]}`;
  }
  const last = points[points.length - 1];
  return `${d} L${last[0]} ${last[1]}`;
}

function marker(id, color, orient) {
  return `<marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="${orient}"><path d="M0 0 L10 5 L0 10 z" fill="${color}"/></marker>`;
}

function document(t, out, w, h, title) {
  const defs = [
    marker("head", t.line, "auto"),
    marker("head-out", t.accent, "auto"),
    marker("head-start", t.line, "auto-start-reverse"),
    marker("head-out-start", t.accent, "auto-start-reverse"),
  ].join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" font-family="${FONT}" role="img" aria-label="${esc(title)}">
<title>${esc(title)}</title>
<defs>${defs}</defs>
<rect width="${w}" height="${h}" fill="${t.bg}"/>
${out.join("\n")}
</svg>
`;
}

/** Shapes that need no other shape: text, rectangle, arrow. */
function primitives(t, out) {
  const text = (x, y, s, { size = 15, weight = 400, fill = t.ink, anchor = "start" } = {}) =>
    out.push(
      `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${esc(s)}</text>`,
    );
  const rect = (x, y, w, h, { fill, stroke, r = 10, dash, sw = 1.5 }) => {
    const dashing = dash ? ` stroke-dasharray="${dash}"` : "";
    out.push(
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${dashing}/>`,
    );
  };
  /** A line through the given points with an arrowhead at the end. */
  const arrow = (points, { dashed = false, color, both = false } = {}) => {
    const stroke = color ?? (dashed ? t.accent : t.line);
    const id = dashed ? "head-out" : "head";
    const dashing = dashed ? ' stroke-dasharray="7 5"' : "";
    const start = both ? ` marker-start="url(#${id}-start)"` : "";
    out.push(
      `<path d="${roundedPath(points)}" fill="none" stroke="${stroke}" stroke-width="2"${dashing} marker-end="url(#${id})"${start}/>`,
    );
  };
  return { text, rect, arrow };
}

/** Labels that sit on a line or a box edge. */
function marks(t, out, { text, rect }) {
  const pill = (x, y, s) => {
    const w = width(s, 11.5, 600) + 16;
    rect(x, y, w, 22, { fill: t.tag, stroke: t.lwLine, r: 11, sw: 1 });
    text(x + w / 2, y + 15.5, s, { size: 11.5, weight: 600, fill: t.lwInk, anchor: "middle" });
  };
  /** A short label on a patch of background, so the line does not run through it. */
  const label = (cx, cy, s, { size = 13, fill = t.soft, weight = 500, bg = t.label } = {}) => {
    const w = width(s, size, weight) + 12;
    out.push(
      `<rect x="${cx - w / 2}" y="${cy - size / 2 - 4}" width="${w}" height="${size + 8}" rx="4" fill="${bg}"/>`,
    );
    text(cx, cy + size * 0.36, s, { size, fill, weight, anchor: "middle" });
  };
  const badge = (cx, cy, n) => {
    out.push(`<circle cx="${cx}" cy="${cy}" r="13" fill="${t.accent}"/>`);
    text(cx, cy + 5, n, { size: 14, weight: 700, fill: t.bg, anchor: "middle" });
  };
  return { pill, label, badge };
}

/** Boxes and boundaries. */
function containers(t, { text, rect }, { pill }) {
  const KIND = {
    lw: [t.lw, t.lwLine, t.lwInk],
    store: [t.store, t.storeLine, t.storeInk],
    own: [t.own, t.ownLine, t.ink],
    out: [t.lw, t.accent, t.lwInk],
  };
  /** A component box: a bold title and centred lines under it. */
  const box = (x, y, w, h, kind, title, lines = [], { size = 16, sub = 13.5, tag } = {}) => {
    const [fill, stroke, ink] = KIND[kind];
    const leaves = kind === "out";
    rect(x, y, w, h, { fill, stroke, dash: leaves ? "7 5" : undefined, sw: leaves ? 2 : 1.5 });
    const titles = [].concat(title);
    const block = titles.length * (size + 4) + lines.length * (sub + 5);
    const top = y + (h - block) / 2 + size;
    titles.forEach((line, i) =>
      text(x + w / 2, top + i * (size + 4), line, {
        size,
        weight: 650,
        fill: ink,
        anchor: "middle",
      }),
    );
    const below = top + titles.length * (size + 4) + sub - size + 3;
    lines.forEach((line, i) =>
      text(x + w / 2, below + i * (sub + 5), line, { size: sub, fill: t.soft, anchor: "middle" }),
    );
    if (tag) pill(x + w - width(tag, 11.5, 600) - 22, y - 11, tag);
  };
  /** A named area: a boundary with its name on the top edge. */
  const zone = (x, y, w, h, name, options = {}) => {
    const { fill = t.zone, stroke = t.zoneLine, dash, size = 14.5, ink = t.soft } = options;
    rect(x, y, w, h, { fill, stroke, r: 14, dash });
    if (name) text(x + 16, y + 24, name, { size, weight: 600, fill: ink });
  };
  return { box, zone };
}

function pen(t) {
  const out = [];
  const basic = primitives(t, out);
  const marked = marks(t, out, basic);
  const svg = (w, h, title) => document(t, out, w, h, title);
  return { t, ...basic, ...marked, ...containers(t, basic, marked), svg };
}

/** 1. Everything in the operator's environment, and the few connections that can leave it. */
function overview(p) {
  const { t } = p;
  const title = "Self-hosted LangWatch: every component runs in your environment";
  p.text(24, 42, title, { size: 22, weight: 700 });
  p.zone(16, 62, 1248, 552, "Your cloud account or data centre");
  p.zone(296, 96, 716, 500, "Your Kubernetes cluster, installed with the LangWatch Helm chart", {
    fill: t.cluster,
    stroke: t.clusterLine,
  });

  p.box(36, 124, 172, 88, "own", ["Coding tools,", "LLM clients"], ["optional"], { size: 15 });
  p.box(36, 244, 172, 88, "own", "Your agents", ["any framework,", "OpenTelemetry"], { size: 15 });
  p.box(36, 364, 172, 88, "own", "Your team", ["browser,", "your single sign-on"], { size: 15 });

  p.box(316, 134, 236, 76, "lw", "AI Gateway (optional)", ["virtual keys, budgets, routing"]);
  p.zone(316, 240, 676, 176, "LangWatch services", { fill: t.bg, stroke: t.lwLine, ink: t.lwInk });
  const services = [
    ["App", ["UI, API,", "trace ingestion"]],
    ["Workers", ["pipeline,", "PII redaction"]],
    ["LangEvals", ["evaluators,", "guardrails"]],
    ["NLP", ["workflows,", "playground"]],
    [["Langy", "(optional)"], ["assistant"]],
  ];
  services.forEach(([name, lines], i) =>
    p.box(332 + i * 130, 278, 122, 122, "lw", name, lines, { size: 16, sub: 13 }),
  );

  p.zone(316, 452, 676, 128, "Data stores: in the cluster, or managed services in your account", {
    fill: t.bg,
    stroke: t.storeLine,
    ink: t.storeInk,
  });
  const stores = [
    ["PostgreSQL", ["users, settings"]],
    ["ClickHouse", ["traces, evaluations"]],
    ["Redis", ["queue, cache"]],
    ["Object storage", ["older data, backups"]],
  ];
  stores.forEach(([name, lines], i) =>
    p.box(332 + i * 163, 490, 155, 74, "store", name, lines, { size: 15.5, sub: 12.5 }),
  );

  p.box(
    1042,
    134,
    204,
    282,
    "own",
    ["Model providers", "you configure"],
    [
      "OpenAI, Anthropic,",
      "Azure OpenAI, Bedrock,",
      "Vertex AI, your own",
      "endpoints",
      "",
      "called with your keys,",
      "under your contracts",
    ],
  );

  p.arrow([
    [208, 168],
    [314, 168],
  ]);
  p.label(252, 152, "LLM calls");
  p.arrow([
    [208, 300],
    [330, 300],
  ]);
  p.label(252, 284, "traces");
  p.arrow([
    [208, 388],
    [330, 388],
  ]);
  p.label(252, 372, "HTTPS");
  p.arrow([
    [552, 172],
    [1040, 172],
  ]);
  p.label(796, 172, "model calls, with your provider keys");
  p.arrow([
    [992, 310],
    [1040, 310],
  ]);
  p.arrow([
    [654, 416],
    [654, 450],
  ]);
  p.label(720, 434, "read and write", { bg: t.cluster });

  p.arrow(
    [
      [992, 372],
      [1027, 372],
      [1027, 668],
    ],
    { dashed: true },
  );
  p.label(1027, 634, "optional", { fill: t.accent, weight: 600 });
  p.box(
    900,
    670,
    346,
    100,
    "out",
    "LangWatch cloud",
    ["nothing is required to reach it:", "an offline license key works without it"],
    { sub: 13 },
  );

  p.text(24, 652, "The only connections to LangWatch (dashed, all optional)", {
    size: 15,
    weight: 700,
  });
  const rows = [
    "Daily usage report: counts and the version. No trace content. One setting turns it off.",
    "License sync: once a day, only for a license that includes hosted services.",
    "Instant Evals and managed models: hosted services that carry content. Off unless the",
    "license includes them, and an admin can switch them off. One setting stops every call.",
  ];
  rows.forEach((row, i) => {
    if (i < 3) p.text(24, 680 + i * 24, `${i + 1}`, { size: 14, weight: 700, fill: t.accent });
    p.text(44, 680 + i * 24, row, { size: 14, fill: t.soft });
  });
  return [1280, 790, title];
}

/** 2. One trace, from the agent to the screen. */
function traceFlow(p) {
  const { t } = p;
  const title = "The path of one trace through a self-hosted install";
  p.text(24, 42, title, { size: 22, weight: 700 });
  p.zone(16, 62, 1248, 446, "Your environment");
  const y = 142;
  const x = (i) => 40 + i * 206;
  p.box(x(0), y, 160, 104, "own", "Your agent", ["sends spans over", "OpenTelemetry"]);
  p.box(x(1), y, 160, 104, "lw", "App", ["checks the API key,", "accepts the spans"]);
  p.box(x(2), y, 160, 104, "store", "Redis", ["queue between", "App and Workers"]);
  p.box(x(3), y, 160, 104, "lw", "Workers", ["redact PII, add cost,", "summarise the trace"]);
  p.box(x(4), y, 160, 104, "store", "ClickHouse", ["events and the", "tables the UI reads"]);
  p.box(x(5), y, 160, 104, "store", "Object storage", ["older data,", "backups"]);
  for (let i = 0; i < 5; i++) {
    p.arrow([
      [x(i) + 160, y + 52],
      [x(i + 1) - 2, y + 52],
    ]);
    p.badge(x(i) + 183, y + 52, i === 4 ? 7 : i + 1);
  }
  const y2 = 372;
  p.box(x(1), y2, 160, 104, "own", "Your team", ["sees the trace", "in the browser"]);
  p.box(x(3), y2, 160, 104, "lw", "LangEvals", ["runs the evaluators", "you set up"]);
  p.box(
    x(4),
    y2,
    160,
    104,
    "own",
    ["Your model", "provider"],
    ["only for model-", "based evaluators"],
    { size: 15 },
  );
  p.arrow(
    [
      [x(3) + 80, y + 107],
      [x(3) + 80, y2 - 2],
    ],
    { both: true },
  );
  p.badge(x(3) + 80, 309, 5);
  p.arrow([
    [x(3) + 160, y2 + 52],
    [x(4) - 2, y2 + 52],
  ]);
  p.arrow([
    [x(4) + 80, y],
    [x(4) + 80, 108],
    [x(1) + 80, 108],
    [x(1) + 80, y - 2],
  ]);
  p.badge(x(2) + 80, 108, 6);
  p.arrow([
    [x(1) + 50, y + 104],
    [x(1) + 50, y2 - 2],
  ]);
  p.badge(x(1) + 50, 309, 6);

  const steps = [
    ["1", "The agent sends spans to the App over OpenTelemetry (OTLP over HTTP)."],
    ["2", "The App puts an ingestion job on the Redis queue."],
    ["3", "A Worker picks the job up. Workers are stateless and scale by replica."],
    ["4", "The Worker redacts PII, adds cost and metrics, and writes to ClickHouse."],
    ["5", "Evaluators you configured run in LangEvals. Scores go to ClickHouse."],
    ["6", "The App reads ClickHouse and pushes the trace to the open browser."],
    ["7", "Older data moves from ClickHouse to object storage."],
  ];
  steps.forEach(([n, line], i) => {
    const col = i < 4 ? 0 : 1;
    const row = i < 4 ? i : i - 4;
    p.badge(40 + col * 624, 548 + row * 36, n);
    p.text(64 + col * 624, 553 + row * 36, line, { size: 14.5, fill: t.soft });
  });
  return [1280, 696, title];
}

/** 3. Who runs what in each deployment model. */
function deployment(p) {
  const { t } = p;
  const title = "Deployment models: who runs each part";
  p.text(24, 42, title, { size: 22, weight: 700 });
  const cols = [
    { name: "LangWatch Cloud", line: "LangWatch runs everything" },
    { name: "Hybrid", line: "trace data is stored in your cloud" },
    { name: "Self-managed", line: "one Helm chart runs it all" },
    { name: "Managed databases", line: "self-managed, chart runs the services" },
  ];
  const W = 296;
  const x = (i) => 24 + i * (W + 16);
  const chip = (cx, y, kind, name, lines = []) =>
    p.box(cx, y, W - 40, lines.length ? 58 : 46, kind, name, lines, { size: 14.5, sub: 12.5 });
  const SERVICES = ["app, workers, evaluators, gateway"];
  cols.forEach((col, i) => {
    p.text(x(i), 84, col.name, { size: 17, weight: 700 });
    p.text(x(i), 106, col.line, { size: 13.5, fill: t.soft });
    p.zone(x(i), 122, W, 226, "Run by LangWatch", {
      fill: t.lw,
      stroke: t.lwLine,
      ink: t.lwInk,
      size: 13.5,
    });
    p.zone(x(i), 364, W, 318, i === 0 ? "Your side" : "Run by you, in your cloud", { size: 13.5 });
  });
  const top = [158, 224, 280];
  // Cloud
  chip(x(0) + 20, top[0], "lw", "LangWatch services", SERVICES);
  chip(x(0) + 20, top[1], "store", "PostgreSQL, Redis");
  chip(x(0) + 20, top[2], "store", "ClickHouse, object storage");
  chip(x(0) + 20, 430, "own", "Your agents", ["send traces to LangWatch Cloud"]);
  p.arrow([
    [x(0) + 236, 428],
    [x(0) + 236, 350],
  ]);
  // Hybrid
  chip(x(1) + 20, top[0], "lw", "LangWatch services", SERVICES);
  chip(x(1) + 20, top[1], "store", "PostgreSQL, Redis");
  chip(x(1) + 20, 430, "store", "ClickHouse", ["traces, evaluations, analytics"]);
  chip(x(1) + 20, 498, "store", "Object storage", ["datasets, older data, backups"]);
  chip(x(1) + 20, 606, "own", "Your agents", ["send traces to LangWatch Cloud"]);
  p.arrow(
    [
      [x(1) + 236, 352],
      [x(1) + 236, 428],
    ],
    { both: true },
  );
  p.label(x(1) + 120, 412, "private link or VPN", { size: 12.5, bg: t.zone });
  // Self-managed
  p.text(x(2) + W / 2, 228, "Nothing runs here", {
    size: 15,
    weight: 600,
    fill: t.lwInk,
    anchor: "middle",
  });
  p.text(x(2) + W / 2, 250, "optional license sync and usage report", {
    size: 12.5,
    fill: t.soft,
    anchor: "middle",
  });
  p.zone(x(2) + 10, 394, W - 20, 216, "Kubernetes cluster", {
    fill: t.cluster,
    stroke: t.clusterLine,
    size: 13,
  });
  chip(x(2) + 20, 426, "lw", "LangWatch services", SERVICES);
  chip(x(2) + 20, 492, "store", "PostgreSQL, Redis");
  chip(x(2) + 20, 546, "store", "ClickHouse");
  chip(x(2) + 20, 622, "store", "Object storage");
  // Self-managed with managed databases
  p.text(x(3) + W / 2, 228, "Nothing runs here", {
    size: 15,
    weight: 600,
    fill: t.lwInk,
    anchor: "middle",
  });
  p.text(x(3) + W / 2, 250, "optional license sync and usage report", {
    size: 12.5,
    fill: t.soft,
    anchor: "middle",
  });
  p.zone(x(3) + 10, 394, W - 20, 104, "Kubernetes cluster", {
    fill: t.cluster,
    stroke: t.clusterLine,
    size: 13,
  });
  chip(x(3) + 20, 426, "lw", "LangWatch services", SERVICES);
  p.zone(x(3) + 10, 508, W - 20, 164, "Managed services in your account", {
    fill: t.bg,
    stroke: t.storeLine,
    ink: t.storeInk,
    size: 13,
  });
  chip(x(3) + 20, 540, "store", "PostgreSQL, Redis, ClickHouse");
  chip(x(3) + 20, 596, "store", "Object storage", ["S3 or Azure Blob"]);

  const facts = [
    ["Trace data stored in", ["LangWatch", "Your cloud", "Your cloud", "Your cloud"]],
    ["Passes through LangWatch", ["Yes", "Yes", "No", "No"]],
  ];
  facts.forEach(([name, values], r) => {
    values.forEach((value, i) => {
      p.text(x(i), 712 + r * 30, name + ":", { size: 13.5, fill: t.soft });
      p.text(x(i) + width(name + ": ", 13.5) + 4, 712 + r * 30, value, { size: 13.5, weight: 700 });
    });
  });
  return [1280, 762, title];
}

/** 4. Identity, keys, secrets and network exposure. */
function security(p) {
  const { t } = p;
  const title = "Security view: identity, keys, secrets and what is exposed";
  p.text(24, 42, title, { size: 22, weight: 700 });
  p.zone(16, 62, 1248, 688, "Your cloud account or data centre");

  p.box(40, 110, 200, 96, "own", "Your team", ["sign in through", "your identity provider"]);
  p.box(
    330,
    110,
    240,
    96,
    "own",
    "Your identity provider",
    ["Entra ID, Okta, Auth0, Google", "OpenID Connect or SAML, SCIM"],
    { tag: "Enterprise license" },
  );
  p.box(660, 110, 220, 96, "own", "Your agents, SDKs, CI", [
    "authenticate with",
    "LangWatch API keys",
  ]);
  p.box(1000, 110, 240, 96, "own", "Your secret manager", [
    "Vault, AWS Secrets Manager,",
    "Azure Key Vault",
  ]);
  p.arrow(
    [
      [243, 140],
      [328, 140],
    ],
    { both: true },
  );
  p.label(284, 124, "sign in", { bg: t.zone });

  p.box(
    40,
    262,
    880,
    62,
    "own",
    "Your ingress or load balancer, with TLS",
    ["the App is the only service exposed; the AI Gateway only when you give it a hostname"],
    { sub: 13.5 },
  );
  p.arrow([
    [120, 206],
    [120, 260],
  ]);
  p.arrow([
    [450, 206],
    [450, 260],
  ]);
  p.arrow([
    [770, 206],
    [770, 260],
  ]);
  p.label(196, 234, "HTTPS, session", { bg: t.zone });
  p.label(524, 234, "sign-in, SCIM", { bg: t.zone });
  p.label(832, 234, "API key", { bg: t.zone });

  p.zone(40, 364, 1200, 362, "Kubernetes cluster: internal only", {
    fill: t.cluster,
    stroke: t.clusterLine,
  });
  p.arrow([
    [420, 324],
    [420, 400],
  ]);
  p.box(
    64,
    402,
    472,
    150,
    "lw",
    "App",
    [
      "checks every request against roles per organisation,",
      "team and project (custom roles with a license)",
      "API keys stored as a keyed hash, never in clear",
      "audit log of who did what (Enterprise license)",
    ],
    { sub: 13.5 },
  );
  p.box(
    64,
    580,
    472,
    122,
    "lw",
    "Workers, NLP, LangEvals, Langy",
    [
      "no external address, reached over cluster DNS",
      "PII redaction runs here, before anything is stored",
      "Langy has no internet access unless you allow it",
    ],
    { sub: 13.5 },
  );

  p.box(
    596,
    402,
    320,
    300,
    "store",
    "Data stores",
    [
      "PostgreSQL, ClickHouse, Redis,",
      "object storage",
      "",
      "private subnets, TLS connections,",
      "encrypted volumes",
      "",
      "provider keys and SSO secrets",
      "encrypted in PostgreSQL (AES-256-GCM)",
      "",
      "every trace query filtered by tenant",
    ],
    { sub: 13.5 },
  );
  p.arrow(
    [
      [539, 476],
      [594, 476],
    ],
    { both: true },
  );
  p.arrow(
    [
      [539, 640],
      [594, 640],
    ],
    { both: true },
  );

  p.box(
    976,
    402,
    240,
    300,
    "own",
    "Kubernetes Secrets",
    [
      "synced from your",
      "secret manager",
      "",
      "encryption key,",
      "session secret,",
      "database passwords,",
      "license key",
      "",
      "read by the pods at start",
    ],
    { sub: 13.5 },
  );
  p.arrow([
    [1120, 206],
    [1120, 400],
  ]);
  p.label(1120, 300, "synced by your operator", { bg: t.zone });
  return [1280, 770, title];
}

const DIAGRAMS = {
  "self-hosting-overview": overview,
  "self-hosting-trace-flow": traceFlow,
  "self-hosting-deployment-models": deployment,
  "self-hosting-security": security,
};
const outDir = resolve(process.argv[2] ?? ".");
mkdirSync(outDir, { recursive: true });
for (const [name, draw] of Object.entries(DIAGRAMS)) {
  for (const [mode, theme] of Object.entries(THEMES)) {
    const p = pen(theme);
    const [w, h, title] = draw(p);
    writeFileSync(resolve(outDir, `${name}-${mode}.svg`), p.svg(w, h, title));
  }
}
console.log(`wrote ${Object.keys(DIAGRAMS).length * 2} files to ${outDir}`);
