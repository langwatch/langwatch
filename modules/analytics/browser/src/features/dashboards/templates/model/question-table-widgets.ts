/**
 * Stored TSX for the question templates' rankings and tables. A panel whose rows
 * can be empty for a good reason (no errors, no thumbs down) reads a second query
 * to tell "nothing wrong" from "nothing connected".
 */

import {
  BARS,
  DATES,
  HEADLINE,
  NUMBERS,
  STAT,
  TABLE,
  TRACE_LINK,
  widgetCode,
} from "./widget-code-parts.ts";

/** A share of a whole, "-" when the whole is zero. */
const SHARE = `const share = (part, whole) => (whole > 0 ? pct(part / whole, 0) : "-");`;

export const ERROR_TYPES_CODE = widgetCode({
  summary: "The five most frequent error types of failed spans, with their operation.",
  subtitle: "What the failing traces fail on",
  source: "requests",
  parts: [NUMBERS, TABLE],
  queries: ["types", "traffic"],
  body: `  if (num(traffic.data[0]?.traces) === 0) return <Panel><CallToAction /></Panel>;
  if (types.data.length === 0) {
    return <Panel><Note color={C.green}>No failed spans in this period</Note></Panel>;
  }
  const columns = [
    { header: "Error type", cell: (row) => row.category },
    { header: "Operation", cell: (row) => mono(row.operation) },
    { header: "Count", align: "right", cell: (row) => <b>{count(num(row.failures))}</b> },
  ];
  return (
    <Panel>
      <Table columns={columns} rows={types.data.slice(0, 5)} />
    </Panel>
  );`,
});

export const MODEL_SPEND_CODE = widgetCode({
  summary: "The five models that cost the most, with each one's share of all model spend.",
  subtitle: "The models behind the bill",
  source: "models",
  parts: [NUMBERS, TABLE, SHARE],
  queries: ["models", "spend"],
  body: `  const total = num(spend.data[0]?.cost);
  if (models.data.length === 0 || total === 0) return <Panel><CallToAction /></Panel>;
  const columns = [
    { header: "Model", cell: (row) => mono(row.model) },
    { header: "Cost", align: "right", cell: (row) => <b>{usd(num(row.cost))}</b> },
    { header: "Share", align: "right", cell: (row) => share(num(row.cost), total) },
  ];
  return (
    <Panel>
      <Table columns={columns} rows={models.data} />
    </Panel>
  );`,
});

export const TOP_MODELS_CODE = widgetCode({
  summary: "The ten models most traces use, with their share of all traces and their cost.",
  subtitle: "The models behind most of your traffic, and so most of your bill",
  source: "models",
  parts: [NUMBERS, TABLE, SHARE],
  queries: ["models", "modelCosts", "traffic"],
  body: `  if (models.data.length === 0) return <Panel><CallToAction /></Panel>;
  const traces = num(traffic.data[0]?.traces);
  const costs = new Map(modelCosts.data.map((row) => [row.model, num(row.cost)]));
  const columns = [
    { header: "Model", cell: (row) => mono(row.model) },
    { header: "Traces", align: "right", cell: (row) => count(num(row.traces)) },
    { header: "Share", align: "right", cell: (row) => share(num(row.traces), traces) },
    { header: "Cost", align: "right", cell: (row) => <b>{usd(costs.get(row.model) || 0)}</b> },
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
  source: "topics",
  parts: [NUMBERS, TABLE, HEADLINE, SHARE],
  queries: ["topics", "topicTraffic"],
  body: `  if (topics.data.length === 0) return <Panel><CallToAction /></Panel>;
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
  subtitle: "Find the slow tail, then watch it shrink as you fix it",
  source: "spans",
  parts: [NUMBERS, TABLE, STAT],
  queries: ["operations", "latency"],
  body: `  if (operations.data.length === 0) return <Panel><CallToAction /></Panel>;
  const spread = latency.data[0] || {};
  const columns = [
    { header: "Operation", cell: (row) => mono(row.operation) },
    { header: "Total time", align: "right", cell: (row) => <b>{ms(num(row.total_ms))}</b> },
    { header: "p95", align: "right", cell: (row) => ms(num(row.p95_ms)) },
    { header: "Spans", align: "right", cell: (row) => count(num(row.spans)) },
  ];
  return (
    <Panel>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8,
        marginBottom: 8 }}>
        <Stat label="Trace p50" value={ms(num(spread.p50_ms))} />
        <Stat label="Trace p99" value={ms(num(spread.p99_ms))} />
      </div>
      <Table columns={columns} rows={operations.data} />
    </Panel>
  );`,
});

export const SLOWEST_MODELS_CODE = widgetCode({
  summary: "The five models whose traces have the highest p95 latency.",
  subtitle: "p95 latency of the traces that call each model",
  source: "models",
  parts: [NUMBERS, BARS, HEADLINE],
  queries: ["main"],
  body: `  if (main.data.length === 0) return <Panel><CallToAction /></Panel>;
  const ranked = main.data.map((row) => ({ label: row.model, value: num(row.p95_ms) }));
  return (
    <Panel>
      <Headline value={ms(ranked[0].value)} label={ranked[0].label + " is slowest at p95"} />
      <Bars rows={ranked} format={ms} />
    </Panel>
  );`,
});

export const THUMBS_DOWN_CODE = widgetCode({
  summary: "Share of negative feedback, then the latest traces users gave a thumbs down.",
  subtitle: "The answers users rejected, newest first",
  source: "feedback",
  parts: [NUMBERS, DATES, TABLE, TRACE_LINK, HEADLINE],
  queries: ["summary", "traces"],
  body: `  const up = num(summary.data[0]?.thumbs_up);
  const down = num(summary.data[0]?.thumbs_down);
  if (up + down === 0) return <Panel><CallToAction /></Panel>;
  const label = count(down) + " of " + count(up + down) + " votes were thumbs down";
  if (traces.data.length === 0) {
    return <Panel><Note color={C.green}>No thumbs down in this period</Note></Panel>;
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
      <Headline value={pct(down / (up + down), 0)} label={label} />
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
    { header: "Score", align: "right", cell: (row) => <b>{num(row.score).toFixed(2)}</b> },
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
  const passRate = (row) => (row.pass_rate === null ? "-" : pct(num(row.pass_rate), 0));
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
