/**
 * The pieces every Flight Deck widget's stored TSX is put together from. The
 * sandbox has no Chakra and no shared module, so each widget carries its own
 * colours and helpers: what a member opens in the edit drawer runs as is.
 */

import type { NavigableTarget } from "@langwatch/analytics-contract/chart-frame-protocol";

/** The sources a panel reads, as the block library names them. */
export type WidgetSource =
  | "traces"
  | "scenarios"
  | "judges"
  | "feedback"
  | "gateway"
  | "codingAgents";

export const PALETTE = `const dark = LW.theme === "dark";
const C = {
  text: dark ? "#f4f4f5" : "#18181b",
  subtle: dark ? "#a1a1aa" : "#52525b",
  faint: dark ? "#71717a" : "#a1a1aa",
  border: dark ? "#27272a" : "#e4e4e7",
  strong: dark ? "#3f3f46" : "#d4d4d8",
  muted: dark ? "#27272a" : "#f4f4f5",
  panel: dark ? "#18181b" : "#ffffff",
  teal: dark ? "#2dd4bf" : "#0d9488",
  orange: "#ed8926",
  pink: "#ed64a6",
  red: dark ? "#f87171" : "#dc2626",
  green: dark ? "#4ade80" : "#16a34a",
};`;

export const NUMBERS = `const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const count = (value) => compact.format(value);
const pct = (value, digits = 1) => (value * 100).toFixed(digits) + "%";
function usd(value) {
  if (value !== 0 && Math.abs(value) < 1) return "$" + value.toFixed(value < 0.01 ? 4 : 2);
  return "$" + compact.format(value);
}
function ms(value) {
  if (value >= 1000) return (value / 1000).toFixed(value >= 10000 ? 0 : 1) + "s";
  return Math.round(value) + "ms";
}`;

/** ClickHouse sends buckets as `YYYY-MM-DD hh:mm:ss` in UTC. */
export const DATES = `const utc = (value) => new Date(String(value).replace(" ", "T") + "Z");
function bucketLabel(value) {
  const daily = LW.dashboardContext.granularitySeconds >= 86400;
  const parts = daily ? { month: "short", day: "numeric" } : { day: "numeric", hour: "numeric" };
  return utc(value).toLocaleString("en-US", parts);
}`;

export const CHART_STYLE = `const AXIS = { fontSize: 14, fill: dark ? C.faint : "#666666" };
const TIP = { background: C.panel, border: "1px solid " + C.border, borderRadius: 8, fontSize: 12 };
const dot = (color) => ({ width: 8, height: 8, borderRadius: 4, background: color });

function Legend({ items }) {
  return (
    <div style={{ display: "flex", gap: 12, marginBottom: 4, fontSize: 10.5, color: C.subtle }}>
      {items.map(([color, label, dashed]) => (
        <span key={label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={dashed ? { width: 12, borderTop: "2px dashed " + color } : dot(color)} />
          {label}
        </span>
      ))}
    </div>
  );
}`;

export const BARS = `const RAMP = ["#4299e1", "#ed8926", "#9f7aea", "#48bb78", "#ed64a6", "#38b2ac", "#0bc5ea"];
// A headline model keeps its colour on every chart; any other name takes its rank's.
const FIXED_COLOURS = {
  "gpt-5": 0,
  "claude-sonnet-4.5": 1,
  "llama-4-70b": 2,
  "gemini-2.5-pro": 3,
  "claude-opus-4.5": 4,
  "gpt-5-mini": 5,
};
const colourFor = (label, index) => RAMP[FIXED_COLOURS[label] ?? index % RAMP.length];
const ELLIPSIS = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const bar = (colour) => ({
  display: "block",
  height: "100%",
  borderRadius: 4,
  opacity: 0.8,
  background: colour,
});

// height fixes the list's box, else it fills what the panel leaves.
function Bars({ rows, format, height }) {
  const max = Math.max(...rows.map((row) => row.value), Number.MIN_VALUE);
  const box = height ? { height } : { flex: 1 };
  return (
    <div style={{ ...box, display: "flex", flexDirection: "column", justifyContent: "center",
      gap: 6 }}>
      {rows.map((row, index) => (
        <div key={row.label} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5 }}>
          <span style={{ width: 128, flexShrink: 0, color: C.subtle, ...ELLIPSIS }}>
            {row.label || "Unknown"}
          </span>
          <span style={{ flex: 1, height: 16, borderRadius: 4, background: C.muted }}>
            <span style={{ ...bar(colourFor(row.label, index)),
              width: (row.value / max) * 100 + "%" }} />
          </span>
          <span style={{ width: 56, textAlign: "right", fontWeight: 500,
            fontVariantNumeric: "tabular-nums" }}>{format(row.value)}</span>
        </div>
      ))}
    </div>
  );
}`;

export const TABLE = `// rowPadding is the space above and below each cell, in px.
function Table({ columns, rows, rowPadding = 4 }) {
  const cell = (column, index) => ({
    textAlign: column.align || "left",
    padding: rowPadding + "px 0",
    paddingRight: index === columns.length - 1 ? 0 : 6,
    fontWeight: 500,
  });
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5,
        fontVariantNumeric: "tabular-nums" }}>
        <thead>
          <tr style={{ color: C.faint }}>
            {columns.map((column, index) => (
              <th key={column.header} style={cell(column, index)}>{column.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} style={{ borderTop: "1px solid " + C.border }}>
              {columns.map((column, index) => (
                <td key={column.header} style={{ ...cell(column, index), fontWeight: 400 }}>
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
const mono = (text, color = C.subtle) => (
  <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 10.5, color }}>{text}</span>
);`;

export const THUMBS = `const THUMB_UP =
  "M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8" +
  "a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88ZM7 10v12";
function Thumb({ up, color }) {
  const flip = up ? undefined : "rotate(180 12 12)";
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
      <path d={THUMB_UP} transform={flip} />
    </svg>
  );
}`;

interface CallToAction {
  readonly title: string;
  readonly line: string;
  readonly icon: string;
  readonly button: string;
  /** The route key `LW.navigate` opens: an allowlisted page, never a raw path. */
  readonly target: NavigableTarget;
}

/** Texts from `SOURCE_CALLS_TO_ACTION`; icons are the Lucide paths the block cards draw. */
const CALLS_TO_ACTION: Readonly<Record<WidgetSource, CallToAction>> = {
  traces: {
    title: "Connect traces to light up the flight deck",
    line: "Once traces flow in you'll see request volume, success rate, p95 latency, cost and the traces that explain every spike.",
    icon: `<path d="M8 5h13M13 12h8M13 19h8M3 10a2 2 0 0 0 2 2h3M3 5v12a2 2 0 0 0 2 2h3" />`,
    button: "Connect traces",
    target: "traces",
  },
  scenarios: {
    title: "Run a scenario",
    line: "Scenario pass rate and coverage across your suites, so you know what behaviour is actually tested.",
    icon: `<path d="M13 5h8M13 12h8M13 19h8M3 17l2 2 4-4M3 7l2 2 4-4" />`,
    button: "Run a scenario",
    target: "scenarios",
  },
  judges: {
    title: "Add a judge",
    line: "Evaluator pass rate plotted against latency and cost, so you can see quality move with load.",
    icon: `<path d="M14 2v6a2 2 0 0 0 .245.96l5.51 10.08A2 2 0 0 1 18 22H6a2 2 0 0 1-1.755-2.96l5.51-10.08A2 2 0 0 0 10 8V2M6.453 15h11.094M8.5 2h7" />`,
    button: "Add a judge",
    target: "onlineEvaluations",
  },
  feedback: {
    title: "Collect feedback",
    line: "Thumbs and annotations from your users, tracked over time next to quality and cost.",
    icon: `<path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z" />`,
    button: "Collect feedback",
    target: "annotations",
  },
  gateway: {
    title: "Route via the Gateway",
    line: "Cost broken down by virtual key / route, so you can see which integration is spending.",
    icon: `<circle cx="6" cy="19" r="3" />
          <path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15" />
          <circle cx="18" cy="5" r="3" />`,
    button: "Route via Gateway",
    target: "gatewayVirtualKeys",
  },
  codingAgents: {
    title: "Connect your coding agents",
    line: "Connect your coding agent to see this.",
    icon: `<path d="M12 8V4H8M2 14h2M20 14h2M15 13v2M9 13v2" />
          <rect width="16" height="12" x="4" y="8" rx="2" />`,
    button: "Connect",
    target: "codingSessions",
  },
};

const BUTTON = `const BUTTON = {
  flexShrink: 0,
  height: 28,
  padding: "0 10px",
  border: 0,
  borderRadius: 8,
  background: C.teal,
  color: "#ffffff",
  fontFamily: "inherit",
  fontSize: 12,
  fontWeight: 500,
  whiteSpace: "nowrap",
  cursor: "pointer",
};
const DASHED = { border: "1px dashed " + C.strong, borderRadius: 8, background: C.muted + "4d" };`;

/**
 * The not-connected face: icon tile, title, one sentence and the button to the page that
 * turns the source on. Compact lays it out as one row, for a panel only a strip tall.
 */
function callToActionCode({ source, compact }: { source: WidgetSource; compact: boolean }) {
  const cta = CALLS_TO_ACTION[source];
  const icon = `<div style={{ ...CENTRED, flexShrink: 0, width: 36, height: 36, borderRadius: 8,
        background: C.muted }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.teal}
          strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          ${cta.icon}
        </svg>
      </div>`;
  const button = `<button style={BUTTON} onClick={() => LW.navigate("${cta.target}", {})}>
        ${cta.button}
      </button>`;
  if (compact) {
    return `${BUTTON}

function CallToAction() {
  return (
    <div style={{ ...DASHED, display: "flex", alignItems: "center", gap: 12,
      padding: "12px 16px" }}>
      ${icon}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>${cta.title}</div>
        <div style={{ fontSize: 11.5, color: C.subtle }}>${cta.line}</div>
      </div>
      ${button}
    </div>
  );
}`;
  }
  return `${BUTTON}

function CallToAction() {
  return (
    <div style={{ ...DASHED, flex: 1, ...CENTRED, gap: 8, padding: "24px 20px",
      textAlign: "center" }}>
      ${icon}
      <div style={{ fontSize: 13, fontWeight: 600 }}>${cta.title}</div>
      <div style={{ fontSize: 11.5, color: C.subtle, maxWidth: 320 }}>
        ${cta.line}
      </div>
      <div style={{ marginTop: 4 }}>
        ${button}
      </div>
    </div>
  );
}`;
}

/**
 * The body frame every face sits in: the app's Inter, and the subtitle line the card header
 * does not draw, pulled up to sit directly under the card's title.
 */
function panelCode(subtitle: string): string {
  return `const CENTRED = { display: "flex", flexDirection: "column", alignItems: "center",
  justifyContent: "center" };
const FRAME_CSS = '@import url("https://fonts.googleapis.com/css2?family=Inter:wght@400..700' +
  '&display=swap"); body { padding: 2px 8px 8px; }';

function Panel({ children }) {
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", color: C.text,
      fontFamily: "Inter, system-ui, sans-serif", fontSize: 13, lineHeight: 1.5 }}>
      <style>{FRAME_CSS}</style>
      <div style={{ fontSize: 11.5, color: C.faint, marginBottom: 8 }}>${subtitle}</div>
      {children}
    </div>
  );
}

function Note({ children, color = C.faint }) {
  return <div style={{ flex: 1, ...CENTRED, fontSize: 11.5, color }}>{children}</div>;
}`;
}

/** The loading and error faces, shared by every query the widget runs. */
function queryStatesCode(queries: readonly string[]): string {
  const calls = queries.map((name) => `  const ${name} = LW.useChartQuery("${name}", {});`);
  const pending = queries.map((name) => `!${name}.data`).join(" || ");
  return `${calls.join("\n")}
  const failed = [${queries.join(", ")}].find((query) => query.isError);
  if (failed) return <Panel><Note color={C.red}>{failed.error.message}</Note></Panel>;
  if (${pending}) return <Panel><Note>Loading</Note></Panel>;`;
}

export interface WidgetCodeSpec {
  /** The one comment line at the top: what the panel shows. */
  readonly summary: string;
  readonly subtitle: string;
  readonly source: WidgetSource;
  /** Recharts components the panel imports, if it draws a chart. */
  readonly recharts?: readonly string[];
  /** Helper snippets from this file, in the order the widget reads them. */
  readonly parts: readonly string[];
  /** The widget's own components, after the helpers. */
  readonly components?: string;
  readonly queries: readonly string[];
  /** The rest of `Widget()` after its loading and error faces. */
  readonly body: string;
  /** Draws the not-connected face as one row, for a panel only a strip tall. */
  readonly compactCallToAction?: boolean;
}

/** One widget's stored TSX, put together from its spec. */
export function widgetCode({
  summary,
  subtitle,
  source,
  recharts,
  parts,
  components,
  queries,
  body,
  compactCallToAction = false,
}: WidgetCodeSpec): string {
  const imports = recharts ? `import { ${recharts.join(", ")} } from "recharts";\n\n` : "";
  const sections = [
    PALETTE,
    ...parts,
    panelCode(subtitle),
    callToActionCode({ source, compact: compactCallToAction }),
    ...(components ? [components] : []),
    `export default function Widget() {\n${queryStatesCode(queries)}\n${body}\n}`,
  ];
  return `// ${summary}\n${imports}${sections.join("\n\n")}\n`;
}
