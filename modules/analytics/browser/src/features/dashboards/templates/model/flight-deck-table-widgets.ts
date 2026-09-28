/**
 * Stored TSX for the Flight Deck's ranking and table panels: Cost efficiency,
 * Failure intelligence, Scenario results, Gateway routing, Your coding agents
 * and Most impactful traces. Each draws the matching block view.
 */

import { BARS, DATES, NUMBERS, TABLE, THUMBS, widgetCode } from "./widget-code-parts.ts";

export const COST_EFFICIENCY_CODE = widgetCode({
  summary: "Cost per successful trace, tokens in and out, and the five models that cost the most.",
  subtitle: "What the spend buys",
  source: "traces",
  parts: [NUMBERS, BARS],
  components: `function Stat({ label, value }) {
  return (
    <div style={{ borderRadius: 6, background: C.muted, padding: "6px 8px" }}>
      <div style={{ fontSize: 10, color: C.faint }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 600 }}>{value}</div>
    </div>
  );
}`,
  queries: ["summary", "models"],
  body: `  const totals = summary.data[0] || {};
  if (num(totals.traces) === 0) return <Panel><CallToAction /></Panel>;
  const successes = num(totals.successes);
  const perSuccess = successes > 0 ? num(totals.cost) / successes : 0;
  const ranked = models.data.map((row) => ({ label: row.model, value: num(row.cost) }));
  return (
    <Panel>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
        <Stat label="Cost / success" value={usd(perSuccess)} />
        <Stat label="Tokens in" value={count(num(totals.tokens_in))} />
        <Stat label="Tokens out" value={count(num(totals.tokens_out))} />
      </div>
      <div style={{ margin: "12px 0 4px", fontSize: 11, fontWeight: 500, color: C.subtle }}>
        Highest-cost models
      </div>
      <Bars rows={ranked} format={usd} />
    </Panel>
  );`,
});

export const FAILURES_CODE = widgetCode({
  summary: "Error spans grouped by exception or error type and operation, most frequent first.",
  subtitle: "Top error categories in the window",
  source: "traces",
  parts: [NUMBERS, DATES, TABLE],
  components: `// A moment as "Thu, Jul 23, 1pm".
function firstSeen(value) {
  const date = utc(value);
  const day = date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const hour = date.toLocaleTimeString("en-US", { hour: "numeric" }).replace(" ", "");
  return day + ", " + hour.toLowerCase();
}`,
  queries: ["main"],
  body: `  if (main.data.length === 0) return <Panel><CallToAction /></Panel>;
  const columns = [
    { header: "Category", cell: (row) => row.category },
    { header: "Operation", cell: (row) => mono(row.operation) },
    {
      header: "First seen",
      cell: (row) => <span style={{ color: C.faint }}>{firstSeen(row.first_seen)}</span>,
    },
    { header: "Count", align: "right", cell: (row) => <b>{count(num(row.failures))}</b> },
  ];
  return (
    <Panel>
      <Table columns={columns} rows={main.data} />
    </Panel>
  );`,
});

export const SCENARIOS_CODE = widgetCode({
  summary: "Share of scenario runs that passed, overall and for the five busiest suites.",
  subtitle: "How much behaviour your scenario suites exercise",
  source: "scenarios",
  parts: [NUMBERS, BARS],
  queries: ["summary", "suites"],
  body: `  const runs = num(summary.data[0]?.runs);
  const passed = num(summary.data[0]?.passed);
  if (runs === 0) return <Panel><CallToAction /></Panel>;
  const ranked = suites.data.map((row) => ({
    label: row.suite,
    value: num(row.runs) > 0 ? num(row.passed) / num(row.runs) : 0,
  }));
  return (
    <Panel>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 22, fontWeight: 600 }}>{pct(passed / runs, 0)}</span>
        <span style={{ fontSize: 11, color: C.subtle }}>
          {count(passed)} / {count(runs)} runs passing
        </span>
      </div>
      <Bars rows={ranked} format={pct} />
    </Panel>
  );`,
});

export const GATEWAY_CODE = widgetCode({
  summary: "Gateway spend per virtual key, the five that spend the most.",
  subtitle: "Cost broken down by virtual key / route",
  source: "gateway",
  parts: [NUMBERS, BARS],
  queries: ["main"],
  body: `  if (main.data.length === 0) return <Panel><CallToAction /></Panel>;
  const ranked = main.data.map((row) => ({ label: row.virtual_key, value: num(row.cost) }));
  return (
    <Panel>
      <Bars rows={ranked} format={usd} />
    </Panel>
  );`,
});

export const CODING_AGENTS_CODE = widgetCode({
  summary: "Sessions, tokens, cost and success rate per coding agent, with its session trend.",
  subtitle: "Sessions, spend and success across Claude Code, Cursor and Codex",
  source: "codingAgents",
  parts: [NUMBERS, TABLE],
  components: `const AGENTS = {
  "claude-code": "Claude Code",
  claude_code: "Claude Code",
  cursor: "Cursor",
  codex: "Codex",
};

function Sparkline({ points }) {
  const max = Math.max(1, ...points);
  const step = 48 / Math.max(1, points.length - 1);
  const path = points.map((point, index) => {
    const y = 14 - (point / max) * 14;
    return (index === 0 ? "M" : "L") + (index * step).toFixed(1) + "," + y.toFixed(1);
  });
  return (
    <svg width="48" height="14">
      <path d={path.join(" ")} fill="none" stroke={C.teal} strokeWidth="1.5" />
    </svg>
  );
}`,
  queries: ["agents", "trend"],
  body: `  if (agents.data.length === 0) return <Panel><CallToAction /></Panel>;
  const trendOf = (agent) =>
    trend.data.filter((row) => row.agent === agent).map((row) => num(row.sessions));
  const columns = [
    { header: "Agent", cell: (row) => AGENTS[String(row.agent).toLowerCase()] || row.agent },
    { header: "Sessions", align: "right", cell: (row) => count(num(row.sessions)) },
    { header: "Tokens", align: "right", cell: (row) => count(num(row.tokens)) },
    { header: "Cost", align: "right", cell: (row) => <b>{usd(num(row.cost))}</b> },
    { header: "Success", align: "right", cell: (row) => pct(num(row.success_rate), 0) },
    { header: "Trend", align: "right", cell: (row) => <Sparkline points={trendOf(row.agent)} /> },
  ];
  return (
    <Panel>
      <Table columns={columns} rows={agents.data} />
    </Panel>
  );`,
});

export const IMPACTFUL_TRACES_CODE = widgetCode({
  summary: "The ten traces with the highest impact: errors, slow and costly runs, thumbs down.",
  subtitle: "Ranked by blended impact: errors, extreme latency, cost, negative feedback",
  source: "traces",
  parts: [NUMBERS, TABLE, THUMBS],
  components: `function Status({ row }) {
  let label = "ok";
  let color = C.green;
  if (num(row.p95_latency) > 0 && num(row.latency_ms) >= num(row.p95_latency)) {
    label = "slow";
    color = C.orange;
  }
  if (num(row.has_error) > 0) {
    label = "error";
    color = C.red;
  }
  return (
    <span style={{ borderRadius: 6, padding: "2px 6px", fontSize: 11, fontWeight: 500, color,
      background: color + "1a" }}>
      {label}
    </span>
  );
}

function Feedback({ value }) {
  if (value === "up") return <Thumb up color={C.green} />;
  if (value === "down") return <Thumb color={C.red} />;
  return <span style={{ color: C.faint }}>-</span>;
}

function TraceLink({ id }) {
  const open = () => LW.navigate("trace", { traceId: id });
  return (
    <span onClick={open} title={id} style={{ cursor: "pointer", display: "block", maxWidth: 64,
      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
      {mono(id, C.teal)}
    </span>
  );
}`,
  queries: ["main"],
  body: `  if (main.data.length === 0) return <Panel><CallToAction /></Panel>;
  const columns = [
    { header: "Trace", cell: (row) => <TraceLink id={row.trace_id} /> },
    { header: "Operation", cell: (row) => mono(row.operation) },
    { header: "Status", cell: (row) => <Status row={row} /> },
    { header: "Latency", align: "right", cell: (row) => ms(num(row.latency_ms)) },
    { header: "Cost", align: "right", cell: (row) => usd(num(row.cost)) },
    { header: "Feedback", align: "center", cell: (row) => <Feedback value={row.feedback} /> },
    { header: "Impact", align: "right", cell: (row) => <b>{Math.round(num(row.impact))}</b> },
  ];
  return (
    <Panel>
      <Table columns={columns} rows={main.data} />
    </Panel>
  );`,
});
