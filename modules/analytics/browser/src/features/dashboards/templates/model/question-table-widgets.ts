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

/** A model's cost, or "price unknown" when none of its calls had one: unknown, never $0.00. */
const MODEL_COST = `function ModelCost({ cost }) {
  if (num(cost) > 0) return <b>{usd(cost)}</b>;
  return <span style={{ color: C.faint }}>price unknown</span>;
}`;

export const MODEL_SPEND_CODE = widgetCode({
  summary: "The five models that cost the most, with each one's share of all model spend.",
  subtitle:
    'What each model cost in this period, most expensive first, with "price unknown" where ' +
    "LangWatch has no price for the model.",
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
      <Table columns={columns} rows={rows} ask={(row) => ({ kind: "model", label: row.model })} />
    </Panel>
  );`,
});

/**
 * Each model's share of the requests that call a model, not of every request: a request
 * calling two models counts for both, so the shares can add up past 100%.
 */
export const MODEL_SHARES = `function modelShares(models, modelRequests) {
  const total = num(modelRequests.data[0]?.traces);
  return models.data.map((row) => ({ ...row, share: ratio(num(row.traces), total) }));
}`;

export const TOP_MODELS_CODE = widgetCode({
  summary: "The ten models most requests use, their share of model requests and their cost.",
  subtitle:
    "Models your agent calls most often, where a request that calls two models counts for both.",
  source: "models",
  parts: [NUMBERS, TABLE, MODEL_SHARES, MODEL_COST],
  queries: ["models", "modelCosts", "modelRequests"],
  body: `  if (models.data.length === 0) return <Panel><CallToAction /></Panel>;
  const costs = new Map(modelCosts.data.map((row) => [row.model, num(row.cost)]));
  const columns = [
    { header: "Model", cell: (row) => mono(row.model) },
    { header: "Requests using it", align: "right", cell: (row) => count(num(row.traces)) },
    { header: "Share of model requests", align: "right", cell: (row) => pct(row.share, 0) },
    { header: "Cost", align: "right", cell: (row) => <ModelCost cost={costs.get(row.model)} /> },
  ];
  return (
    <Panel>
      <Table columns={columns} rows={modelShares(models, modelRequests)} rowPadding={3}
        ask={(row) => ({ kind: "model", label: row.model })} />
    </Panel>
  );`,
});

export const TOPICS_CODE = widgetCode({
  summary: "The ten topics with the most traces, their share, and the topic that grew most.",
  subtitle:
    "LangWatch groups similar requests into topics, so the top ones tell you what to improve next.",
  parts: [NUMBERS, TABLE, HEADLINE, SHARE],
  queries: ["topics", "topicTraffic"],
  body: `  if (topics.data.length === 0) {
    return (
      <Panel>
        <Note>
          No topics yet. LangWatch groups requests into topics once it has a few hundred of them.
        </Note>
      </Panel>
    );
  }
  const total = num(topicTraffic.data[0]?.traces);
  const name = (row) => row.topic || "Unnamed topic";
  const grew = topics.data.reduce((top, row) => (num(row.growth) > num(top.growth) ? row : top));
  const change = (value) => (value > 0 ? "+" : "") + count(value);
  const columns = [
    { header: "Topic", cell: (row) => name(row) },
    { header: "Requests", align: "right", cell: (row) => count(num(row.traces)) },
    { header: "Share", align: "right", cell: (row) => share(num(row.traces), total) },
    {
      header: "Change",
      align: "right",
      cell: (row) => <span style={{ color: C.subtle }}>{change(num(row.growth))}</span>,
    },
  ];
  return (
    <Panel>
      <Headline value={name(topics.data[0])}
        label={share(num(topics.data[0].traces), total) + " of requests with a topic. " +
          "Growing fastest: " + name(grew)} />
      <Table columns={columns} rows={topics.data} rowPadding={3}
        ask={(row) => ({ kind: "topic", label: name(row) })} />
    </Panel>
  );`,
});

export const SLOWEST_OPERATIONS_CODE = widgetCode({
  summary: "Typical and slowest trace latency, then the five operations that take the most time.",
  subtitle: "Which step takes the biggest share of each reply. Fix the top one first.",
  source: "spans",
  parts: [NUMBERS, TABLE, STAT],
  queries: ["operations", "latency"],
  body: `  if (operations.data.length === 0) return <Panel><CallToAction /></Panel>;
  const spread = latency.data[0] || {};
  const columns = [
    { header: "Step", cell: (row) => mono(row.operation) },
    { header: "Total time", align: "right", cell: (row) => <b>{ms(num(row.total_ms))}</b> },
    { header: "Slowest 1 in 20", align: "right", cell: (row) => ms(num(row.p95_ms)) },
    { header: "Calls", align: "right", cell: (row) => count(num(row.spans)) },
  ];
  return (
    <Panel>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8,
        marginBottom: 8 }}>
        <Stat label="Typical reply" value={ms(num(spread.p50_ms))} />
        <Stat label="Slowest 1 in 100" value={ms(num(spread.p99_ms))} />
      </div>
      <Table columns={columns} rows={operations.data}
        ask={(row) => ({ kind: "step", label: row.operation })} />
    </Panel>
  );`,
});

export const SLOWEST_MODELS_CODE = widgetCode({
  summary: "The five models whose traces have the slowest response time.",
  subtitle:
    "Time each model takes to answer, at the slow end: the figure that 1 in 20 of its calls " +
    "took longer than.",
  source: "models",
  parts: [NUMBERS, BARS, HEADLINE],
  queries: ["main"],
  body: `  if (main.data.length === 0) return <Panel><CallToAction /></Panel>;
  const ranked = main.data.map((row) => ({ label: row.model, value: num(row.p95_ms) }));
  // The slowest model takes over twice as long as the next one.
  signalProblem(ranked.length > 1 && num(ranked[1].value) > 0 &&
    ranked[0].value > ranked[1].value * 2);
  return (
    <Panel>
      <Headline value={ms(ranked[0].value)}
        label={"for 1 in 20 replies of " + ranked[0].label + ", the slowest model"} />
      <Bars rows={ranked} format={ms} kind="model" />
    </Panel>
  );`,
});

export const THUMBS_DOWN_CODE = widgetCode({
  summary: "Share of reviewer thumbs down, then the latest traces reviewers voted down.",
  subtitle: "Answers your team marked with a thumbs down in LangWatch, newest first.",
  source: "feedback",
  parts: [NUMBERS, DATES, TABLE, TRACE_LINK, HEADLINE],
  queries: ["summary", "traces"],
  body: `  const up = num(summary.data[0]?.thumbs_up);
  const down = num(summary.data[0]?.thumbs_down);
  if (!add(up, down)) return <Panel><CallToAction /></Panel>;
  const label = count(down) + " of " + count(add(up, down)) + " reviewer votes were thumbs down";
  signalProblem(down > 0);
  if (traces.data.length === 0) {
    return (
      <Panel>
        <Note color={C.green}>
          Your reviewers gave no thumbs down in this period.
        </Note>
      </Panel>
    );
  }
  const when = (value) =>
    utc(value).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric" });
  const columns = [
    { header: "Answer", cell: (row) => <TraceLink id={row.trace_id} /> },
    { header: "Thumbs down", align: "right", cell: (row) => count(num(row.thumbs_down)) },
    {
      header: "When",
      align: "right",
      cell: (row) => <span style={{ color: C.faint }}>{when(row.last_at)}</span>,
    },
  ];
  return (
    <Panel>
      <Headline value={pct(ratio(down, add(up, down)), 0)} label={label} />
      <Table columns={columns} rows={traces.data} rowPadding={3}
        ask={(row) => ({ kind: "answer", label: row.trace_id })} />
    </Panel>
  );`,
});

export const LOWEST_SCORES_CODE = widgetCode({
  summary: "The eight evaluation results with the lowest score, each linked to its trace.",
  subtitle:
    "The answers that scored lowest on each automatic check, with the score out of that check's " +
    "maximum.",
  source: "evaluations",
  parts: [NUMBERS, TABLE, TRACE_LINK],
  queries: ["main"],
  body: `  if (main.data.length === 0) return <Panel><CallToAction /></Panel>;
  const verdict = (row) => {
    if (row.passed === null || row.passed === undefined) {
      return <span style={{ color: C.faint }}>-</span>;
    }
    const passed = row.passed === true || num(row.passed) === 1;
    return <span style={{ color: passed ? C.green : C.red }}>{passed ? "Yes" : "No"}</span>;
  };
  const columns = [
    { header: "Answer", cell: (row) => <TraceLink id={row.trace_id} /> },
    { header: "Check", cell: (row) => row.evaluator || "Unnamed check" },
    { header: "Score", align: "right", cell: (row) => <b>{known(row.score) ? num(row.score).toFixed(2) : GAP}</b> },
    { header: "Passed", align: "right", cell: verdict },
  ];
  return (
    <Panel>
      <Table columns={columns} rows={main.data} rowPadding={3}
        ask={(row) => ({ kind: "answer", label: row.trace_id })} />
    </Panel>
  );`,
});

export const LOWEST_PASSING_EVALUATORS_CODE = widgetCode({
  summary: "The five evaluators with the lowest pass rate, with their run counts.",
  subtitle:
    "Automatic checks your agent fails most, lowest pass rate first, once a check has 20 answers.",
  source: "evaluations",
  parts: [NUMBERS, TABLE],
  queries: ["main"],
  body: `  if (main.data.length === 0) return <Panel><CallToAction /></Panel>;
  signalProblem(main.data.some((row) => known(row.pass_rate) && num(row.pass_rate) < 0.8));
  const columns = [
    { header: "Check", cell: (row) => row.evaluator || "Unnamed check" },
    { header: "Answers passed", align: "right", cell: (row) => <b>{pct(num(row.pass_rate), 0)}</b> },
    { header: "Answers checked", align: "right", cell: (row) => count(num(row.runs)) },
  ];
  return (
    <Panel>
      <Table columns={columns} rows={main.data}
        ask={(row) => ({ kind: "check", label: row.evaluator || "Unnamed check" })} />
    </Panel>
  );`,
});

export const EVALUATION_COVERAGE_CODE = widgetCode({
  summary: "What each evaluator runs on, its pass rate, and the share of traces evaluated at all.",
  subtitle: "How much of your agent's traffic your automatic checks read.",
  source: "evaluations",
  parts: [NUMBERS, TABLE, HEADLINE, SHARE],
  queries: ["evaluators", "evaluated", "traffic"],
  body: `  if (evaluators.data.length === 0) return <Panel><CallToAction /></Panel>;
  const traces = num(traffic.data[0]?.traces);
  const evaluatedTraces = num(evaluated.data[0]?.traces);
  const passRate = (row) => pct(num(row.pass_rate), 0);
  const coverage = ratio(evaluatedTraces, traces);
  signalProblem(known(coverage) && coverage < 0.5);
  const columns = [
    { header: "Check", cell: (row) => row.evaluator || "Unnamed check" },
    { header: "Requests checked", align: "right", cell: (row) => count(num(row.runs)) },
    { header: "Passed", align: "right", cell: passRate },
    { header: "Share of requests", align: "right",
      cell: (row) => <b>{share(num(row.traces), traces)}</b> },
  ];
  return (
    <Panel>
      <Headline value={share(evaluatedTraces, traces)} label="of requests were checked at least once" />
      <Table columns={columns} rows={evaluators.data} rowPadding={3} />
    </Panel>
  );`,
});
