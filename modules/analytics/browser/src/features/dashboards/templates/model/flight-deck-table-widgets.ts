/**
 * Stored TSX for the Flight Deck's ranking and table panels: Cost efficiency,
 * Failure intelligence, Scenario results, Gateway routing, Your coding agents
 * and Most impactful traces. Each draws the matching block view.
 */

import {
  BARS,
  COMPLETENESS,
  DATES,
  NUMBERS,
  STAT,
  TABLE,
  THUMBS,
  TRACE_LINK,
  widgetCode,
} from "./widget-code-parts.ts";

export const COST_EFFICIENCY_CODE = widgetCode({
  summary:
    "Cost per request without an error, tokens in and out, and the five models that cost the " +
    "most.",
  subtitle:
    "What a request that ran without errors costs, leaving out requests on a model with no " +
    "price. No error does not mean the answer was right.",
  source: "traces",
  parts: [NUMBERS, COMPLETENESS, BARS, STAT],
  components: `const LINK = { border: 0, padding: 0, background: "none", color: C.teal,
  fontFamily: "inherit", fontSize: 11, fontWeight: 500, cursor: "pointer" };
const OUTCOME = { kind: "outcome", label: "how each conversation ended" };

// No error is not a right answer: what it takes to know which answers did the job.
function OutcomeNote() {
  return (
    <div style={{ marginTop: 10, fontSize: 11, color: C.subtle, display: "flex",
      flexWrap: "wrap", gap: 12 }}>
      <span>Can't tell which answers were right yet.</span>
      <button type="button" style={LINK}
        onClick={() => LW.navigate("onlineEvaluations", {})}>Score how conversations end</button>
      {canAskLangy() ? (
        <button type="button" style={LINK} onClick={() => askLangy(OUTCOME)}>
          Ask Langy to set it up
        </button>
      ) : null}
    </div>
  );
}`,
  queries: ["summary", "models"],
  body: `  const totals = summary.data[0] || {};
  if (!num(totals.traces)) return <Panel><CallToAction /></Panel>;
  const perRequest = ratio(totals.cost, num(totals.error_free) * pricedShare(summary));
  const priced = models.data.map((row) => ({ label: row.model, value: num(row.cost) || null,
    note: "price unknown" }));
  const ranked = [...priced, ...unpricedRows(summary, priced.map((row) => row.label))];
  return (
    <Panel>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
        <Stat label="Cost per request without an error" value={usd(perRequest)} />
        <Stat label="Tokens sent" value={count(num(totals.tokens_in))} />
        <Stat label="Tokens received" value={count(num(totals.tokens_out))} />
      </div>
      <div style={{ margin: "12px 0 4px", fontSize: 11, fontWeight: 500, color: C.subtle }}>
        Models that cost most
      </div>
      <Bars rows={ranked} format={usd} height={128} kind="model" />
      <OutcomeNote />
    </Panel>
  );`,
});

export const FAILURES_CODE = widgetCode({
  summary: "Error spans grouped by exception or error type and operation, most frequent first.",
  subtitle: "The errors your agent hit most in this period, and the step where each happened.",
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
    { header: "Error", cell: (row) => row.category },
    { header: "Where", cell: (row) => row.operation },
    {
      header: "First seen",
      cell: (row) => <span style={{ color: C.faint }}>{firstSeen(row.first_seen)}</span>,
    },
    {
      header: "Errors",
      align: "right",
      cell: (row) => <b>{count(num(row.failures))}</b>,
    },
  ];
  signalProblem(main.data.some((row) => num(row.failures) > 0));
  return (
    <Panel>
      <Table columns={columns} rows={main.data}
        ask={(row) => ({ kind: "error", label: row.category })} />
    </Panel>
  );`,
});

export const SCENARIOS_CODE = widgetCode({
  summary: "Share of scenario runs that passed, overall and for the five busiest suites.",
  subtitle: "Share of test runs that passed in each test suite.",
  source: "scenarios",
  parts: [NUMBERS, BARS],
  queries: ["summary", "suites"],
  body: `  const runs = num(summary.data[0]?.runs);
  const passed = num(summary.data[0]?.passed);
  if (!runs) return <Panel><CallToAction /></Panel>;
  const ranked = suites.data.map((row) => ({ label: row.suite, key: row.suite_id,
    value: ratio(row.passed, row.runs) }));
  return (
    <Panel>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 22, fontWeight: 600 }}>{pct(passed / runs, 0)}</span>
        <span style={{ fontSize: 11, color: C.subtle }}>
          of test runs passed ({count(passed)} of {count(runs)})
        </span>
      </div>
      <Bars rows={ranked} format={pct} kind="suite" />
    </Panel>
  );`,
});

export const GATEWAY_CODE = widgetCode({
  summary: "Gateway spend per virtual key, the five that spend the most.",
  subtitle: "Spend through the AI gateway, by key.",
  source: "gateway",
  parts: [NUMBERS, BARS],
  queries: ["main"],
  body: `  if (main.data.length === 0) return <Panel><CallToAction /></Panel>;
  const ranked = main.data.map((row) => ({ label: row.virtual_key, value: num(row.cost) }));
  return (
    <Panel>
      <Bars rows={ranked} format={usd} kind="key" />
    </Panel>
  );`,
});

export const CODING_AGENTS_CODE = widgetCode({
  summary:
    "Sessions, tokens, cost and the share of sessions without an error per coding agent, with " +
    "its session trend.",
  subtitle: "Sessions, spend and sessions that ran without errors, per coding agent.",
  source: "codingAgents",
  parts: [NUMBERS, TABLE],
  components: `const AGENTS = {
  "claude-code": "Claude Code",
  claude_code: "Claude Code",
  cursor: "Cursor",
  codex: "Codex",
};

// A missing point lifts the pen, so the line breaks instead of dropping to 0.
function Sparkline({ points }) {
  const max = Math.max(1, ...points.filter(known));
  const step = 48 / Math.max(1, points.length - 1);
  const path = points.map((point, index) => {
    if (!known(point)) return "";
    const y = 14 - (point / max) * 14;
    const moveTo = index === 0 || !known(points[index - 1]);
    return (moveTo ? "M" : "L") + (index * step).toFixed(1) + "," + y.toFixed(1);
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
  const name = (row) => AGENTS[String(row.agent).toLowerCase()] || row.agent;
  const columns = [
    { header: "Agent", cell: name },
    { header: "Sessions", align: "right", cell: (row) => count(num(row.sessions)) },
    { header: "Tokens", align: "right", cell: (row) => count(num(row.tokens)) },
    { header: "Cost", align: "right", cell: (row) => <b>{usd(num(row.cost))}</b> },
    { header: "Without errors", align: "right", cell: (row) => pct(num(row.error_free_rate), 0) },
    { header: "Trend", align: "right", cell: (row) => <Sparkline points={trendOf(row.agent)} /> },
  ];
  return (
    <Panel>
      <Table columns={columns} rows={agents.data}
        ask={(row) => ({ kind: "agent", label: name(row), value: row.agent })} />
    </Panel>
  );`,
});

export const IMPACTFUL_TRACES_CODE = widgetCode({
  summary: "The ten traces with the highest impact: errors, slow and costly runs, thumbs down.",
  subtitle: "Requests that failed, ran slowest, cost most or got a thumbs down, worst first.",
  source: "traces",
  parts: [NUMBERS, TABLE, THUMBS, TRACE_LINK],
  components: `function Status({ row }) {
  let label = "OK";
  let color = C.green;
  if (num(row.p95_latency) > 0 && num(row.latency_ms) >= num(row.p95_latency)) {
    label = "Slow";
    color = C.orange;
  }
  if (num(row.has_error) > 0) {
    label = "Failed";
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
}`,
  queries: ["main"],
  body: `  if (main.data.length === 0) return <Panel><CallToAction /></Panel>;
  const columns = [
    { header: "Request", cell: (row) => <TraceLink id={row.trace_id} /> },
    { header: "Step", cell: (row) => row.operation },
    { header: "What went wrong", cell: (row) => <Status row={row} /> },
    { header: "Time", align: "right", cell: (row) => ms(num(row.latency_ms)) },
    { header: "Cost", align: "right", cell: (row) => usd(num(row.cost)) },
    { header: "Feedback", align: "center", cell: (row) => <Feedback value={row.feedback} /> },
  ];
  signalProblem(main.data.some((row) => num(row.has_error) > 0));
  return (
    <Panel>
      <Table columns={columns} rows={main.data} rowPadding={3}
        ask={(row) => ({ kind: "request", label: row.trace_id })} />
    </Panel>
  );`,
});
