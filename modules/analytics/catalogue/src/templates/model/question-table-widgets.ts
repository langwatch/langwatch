/**
 * Stored TSX for the question templates' rankings and tables. A panel whose rows
 * can be empty for a good reason (no errors, no thumbs down) reads a second query
 * to tell "nothing wrong" from "nothing connected".
 */

import {
  BARS,
  COMPLETENESS,
  DATES,
  HEADLINE,
  NUMBERS,
  STAT,
  TABLE,
  TRACE_LINK,
  widgetCode,
} from "./widget-code-parts.ts";

/** A share of a whole, a dash when the part is unknown or the whole is zero. */
const SHARE = `const share = (part, whole) => pct(ratio(part, whole), 0);`;

/** A model's cost, or "no price" when none of its calls had one: unknown, never $0.00. */
const MODEL_COST = `function ModelCost({ cost }) {
  if (num(cost) > 0) return <b>{usd(cost)}</b>;
  return <span style={{ color: C.faint }}>no price</span>;
}`;

export const MODEL_SPEND_CODE = widgetCode({
  summary: "The five models that cost the most, with each one's share of all model spend.",
  subtitle:
    "The models behind the bill. A model with no price shows its row with a dash: its cost is " +
    "unknown, not zero",
  source: "models",
  parts: [NUMBERS, COMPLETENESS, TABLE, SHARE, MODEL_COST],
  queries: ["models", "spend"],
  body: `  const total = num(spend.data[0]?.cost);
  if (models.data.length === 0 && !total) return <Panel><CallToAction /></Panel>;
  const listed = models.data.map((row) => row.model);
  const rows = [
    ...models.data,
    ...unpricedRows(spend, listed).map((row) => ({ model: row.label, cost: null })),
  ];
  const columns = [
    { header: "Model", cell: (row) => mono(row.model) },
    { header: "Cost", align: "right", cell: (row) => <ModelCost cost={row.cost} /> },
    { header: "Share", align: "right",
      cell: (row) => (num(row.cost) > 0 ? share(num(row.cost), total) : GAP) },
  ];
  return (
    <Panel>
      <Table columns={columns} rows={rows} />
    </Panel>
  );`,
});

export const TOP_MODELS_CODE = widgetCode({
  summary: "The ten models most traces use, with their share of all traces and their cost.",
  subtitle: "The models behind most of your traffic, and so most of your bill",
  source: "models",
  parts: [NUMBERS, TABLE, SHARE, MODEL_COST],
  queries: ["models", "modelCosts", "traffic"],
  body: `  if (models.data.length === 0) return <Panel><CallToAction /></Panel>;
  const traces = num(traffic.data[0]?.traces);
  const costs = new Map(modelCosts.data.map((row) => [row.model, num(row.cost)]));
  const columns = [
    { header: "Model", cell: (row) => mono(row.model) },
    { header: "Traces", align: "right", cell: (row) => count(num(row.traces)) },
    { header: "Share", align: "right", cell: (row) => share(num(row.traces), traces) },
    { header: "Cost", align: "right", cell: (row) => <ModelCost cost={costs.get(row.model)} /> },
  ];
  return (
    <Panel>
      <Table columns={columns} rows={models.data} rowPadding={3} />
    </Panel>
  );`,
});

export const TOPICS_CODE = widgetCode({
  summary: "The ten topics with the most traces, their share, and the topic that grew most.",
  subtitle: "Turn the most common questions into a roadmap",
  parts: [NUMBERS, TABLE, HEADLINE, SHARE],
  queries: ["topics", "topicTraffic"],
  body: `  if (topics.data.length === 0) {
    return <Panel><Note>No traces with a topic in this period.</Note></Panel>;
  }
  const total = num(topicTraffic.data[0]?.traces);
  const name = (row) => row.topic || row.topic_id;
  const grew = topics.data.reduce((top, row) => (num(row.growth) > num(top.growth) ? row : top));
  const change = (value) => (value > 0 ? "+" : "") + count(value);
  const columns = [
    { header: "Topic", cell: (row) => name(row) },
    { header: "Traces", align: "right", cell: (row) => count(num(row.traces)) },
    { header: "Share", align: "right", cell: (row) => share(num(row.traces), total) },
    {
      header: "Second half",
      align: "right",
      cell: (row) => <span style={{ color: C.subtle }}>{change(num(row.growth))}</span>,
    },
  ];
  return (
    <Panel>
      <Headline value={name(grew)}
        label={"grew most, " + change(num(grew.growth)) + " traces in the second half"} />
      <Table columns={columns} rows={topics.data} rowPadding={3} />
    </Panel>
  );`,
});

export const SLOWEST_OPERATIONS_CODE = widgetCode({
  summary: "Typical and slowest trace latency, then the five operations that take the most time.",
  subtitle:
    "Find the slow tail, then watch it shrink as you fix it. Typical is the median trace, " +
    "slowest the 99th percentile; an operation's slowest is its 95th percentile",
  source: "spans",
  parts: [NUMBERS, TABLE, STAT],
  queries: ["operations", "latency"],
  body: `  if (operations.data.length === 0) return <Panel><CallToAction /></Panel>;
  const spread = latency.data[0] || {};
  const columns = [
    { header: "Operation", cell: (row) => mono(row.operation) },
    { header: "Total time", align: "right", cell: (row) => <b>{ms(num(row.total_ms))}</b> },
    { header: "Slowest", align: "right", cell: (row) => ms(num(row.p95_ms)) },
    { header: "Spans", align: "right", cell: (row) => count(num(row.spans)) },
  ];
  return (
    <Panel>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8,
        marginBottom: 8 }}>
        <Stat label="Typical trace" value={ms(num(spread.p50_ms))} />
        <Stat label="Slowest traces" value={ms(num(spread.p99_ms))} />
      </div>
      <Table columns={columns} rows={operations.data} />
    </Panel>
  );`,
});

export const SLOWEST_MODELS_CODE = widgetCode({
  summary: "The five models whose traces have the slowest response time.",
  subtitle:
    "Response time of the traces that call each model, at the 95th percentile: 1 in 20 took " +
    "longer",
  source: "models",
  parts: [NUMBERS, BARS, HEADLINE],
  queries: ["main"],
  body: `  if (main.data.length === 0) return <Panel><CallToAction /></Panel>;
  const ranked = main.data.map((row) => ({ label: row.model, value: num(row.p95_ms) }));
  return (
    <Panel>
      <Headline value={ms(ranked[0].value)} label={ranked[0].label + " is slowest"} />
      <Bars rows={ranked} format={ms} />
    </Panel>
  );`,
});

export const THUMBS_DOWN_CODE = widgetCode({
  summary: "Share of reviewer thumbs down, then the latest traces reviewers voted down.",
  subtitle: "Thumbs from people reviewing traces in LangWatch, newest first",
  source: "feedback",
  parts: [NUMBERS, DATES, TABLE, TRACE_LINK, HEADLINE],
  queries: ["summary", "traces"],
  body: `  const up = num(summary.data[0]?.thumbs_up);
  const down = num(summary.data[0]?.thumbs_down);
  if (!add(up, down)) return <Panel><CallToAction /></Panel>;
  const label = count(down) + " of " + count(add(up, down)) + " reviewer votes were thumbs down";
  if (traces.data.length === 0) {
    return <Panel><Note color={C.green}>No reviewer thumbs down in this period</Note></Panel>;
  }
  const when = (value) =>
    utc(value).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric" });
  const columns = [
    { header: "Trace", cell: (row) => <TraceLink id={row.trace_id} /> },
    { header: "Thumbs down", align: "right", cell: (row) => count(num(row.thumbs_down)) },
    {
      header: "Last",
      align: "right",
      cell: (row) => <span style={{ color: C.faint }}>{when(row.last_at)}</span>,
    },
  ];
  return (
    <Panel>
      <Headline value={pct(ratio(down, add(up, down)), 0)} label={label} />
      <Table columns={columns} rows={traces.data} rowPadding={3} />
    </Panel>
  );`,
});

export const LOWEST_SCORES_CODE = widgetCode({
  summary: "The eight evaluation results with the lowest score, each linked to its trace.",
  subtitle: "Start from the answers your evaluators scored worst",
  source: "evaluations",
  parts: [NUMBERS, TABLE, TRACE_LINK],
  queries: ["main"],
  body: `  if (main.data.length === 0) return <Panel><CallToAction /></Panel>;
  const verdict = (row) => {
    if (row.passed === null || row.passed === undefined) {
      return <span style={{ color: C.faint }}>-</span>;
    }
    const passed = row.passed === true || num(row.passed) === 1;
    return <span style={{ color: passed ? C.green : C.red }}>{passed ? "pass" : "fail"}</span>;
  };
  const columns = [
    { header: "Trace", cell: (row) => <TraceLink id={row.trace_id} /> },
    { header: "Evaluator", cell: (row) => row.evaluator || "Unnamed" },
    { header: "Score", align: "right", cell: (row) => <b>{known(row.score) ? num(row.score).toFixed(2) : GAP}</b> },
    { header: "Verdict", align: "right", cell: verdict },
  ];
  return (
    <Panel>
      <Table columns={columns} rows={main.data} rowPadding={3} />
    </Panel>
  );`,
});

export const LOWEST_PASSING_EVALUATORS_CODE = widgetCode({
  summary: "The five evaluators with the lowest pass rate, with their run counts.",
  subtitle: "Where quality slips first",
  source: "evaluations",
  parts: [NUMBERS, TABLE],
  queries: ["main"],
  body: `  if (main.data.length === 0) return <Panel><CallToAction /></Panel>;
  const columns = [
    { header: "Evaluator", cell: (row) => row.evaluator || "Unnamed" },
    { header: "Pass rate", align: "right", cell: (row) => <b>{pct(num(row.pass_rate), 0)}</b> },
    { header: "Runs", align: "right", cell: (row) => count(num(row.runs)) },
  ];
  return (
    <Panel>
      <Table columns={columns} rows={main.data} />
    </Panel>
  );`,
});

export const EVALUATION_COVERAGE_CODE = widgetCode({
  summary: "What each evaluator runs on, its pass rate, and the share of traces evaluated at all.",
  subtitle: "Start from real traces and watch coverage grow as judges come online",
  source: "evaluations",
  parts: [NUMBERS, TABLE, HEADLINE, SHARE],
  queries: ["evaluators", "evaluated", "traffic"],
  body: `  if (evaluators.data.length === 0) return <Panel><CallToAction /></Panel>;
  const traces = num(traffic.data[0]?.traces);
  const evaluatedTraces = num(evaluated.data[0]?.traces);
  const passRate = (row) => pct(num(row.pass_rate), 0);
  const columns = [
    { header: "Evaluator", cell: (row) => row.evaluator || "Unnamed" },
    { header: "Runs", align: "right", cell: (row) => count(num(row.runs)) },
    { header: "Pass rate", align: "right", cell: passRate },
    { header: "Coverage", align: "right", cell: (row) => <b>{share(num(row.traces), traces)}</b> },
  ];
  return (
    <Panel>
      <Headline value={share(evaluatedTraces, traces)} label="of traces evaluated at least once" />
      <Table columns={columns} rows={evaluators.data} rowPadding={3} />
    </Panel>
  );`,
});
