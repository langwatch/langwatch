/**
 * Stored TSX for the Running costs board (Spend, Production vs testing, Wasted spend) and its
 * use-case cost cards (Cost per call with speech vendors, Cost per document), each drawing what
 * Rogerio's prototype card computes. Every dollar is a sum of trace and evaluator cost.
 */

import {
  BARS,
  CHART_STYLE,
  DATES,
  HEADLINE,
  NUMBERS,
  TABLE,
  widgetCode,
} from "../../templates/model/widget-code-parts.ts";
import {
  FIGURES,
  MARKED_CHART,
  MARKED_CHART_IMPORTS,
  PIVOT,
  RATIO,
  TRACES_LINK,
} from "./flight-deck-costs-parts.ts";

/** Spend: whether the month stays within what the team expects to pay. */
export const SPEND_CODE = widgetCode({
  summary:
    "Spend against the period before, cost per resolved conversation and the month forecast.",
  subtitle: "Production, evaluations and simulations together",
  source: "traces",
  compactCallToAction: true,
  parts: [NUMBERS, RATIO, FIGURES],
  queries: ["spend", "outcomes", "month"],
  body: `  const s = spend.data[0] || {};
  const o = outcomes.data[0] || {};
  const m = month.data[0] || {};
  const cost = num(s.cost);
  if (cost === 0 && num(s.conversations) === 0) return <Panel><CallToAction /></Panel>;
  const resolved = num(o.resolved);
  const perSuccess = ratio(cost, resolved);
  const daysLeft = num(m.days_in_month) - num(m.day_of_month);
  const forecast = num(m.month_to_date) + (num(m.last_7_days) / 7) * daysLeft;
  const monthName = new Date().toLocaleString("en-US", { month: "long", timeZone: "UTC" });
  return (
    <Panel>
      <Figures>
        <Figure label="Spent" value={usd(cost)}>
          <Change now={cost} before={num(s.cost_prev)} better="down" format={usd} />
        </Figure>
        <Figure label="Cost per success" value={resolved > 0 ? usd(perSuccess) : "Not measured"}>
          {resolved > 0 ? (
            <Change now={perSuccess} before={ratio(num(s.cost_prev), num(o.resolved_prev))}
              better="down" format={usd} />
          ) : (
            <Hint onClick={() => LW.navigate("onlineEvaluations", {})}>
              Add an outcome judge
            </Hint>
          )}
        </Figure>
        <Figure label={monthName + " forecast"} value={usd(forecast)}>
          <Hint>{usd(num(m.month_to_date))} so far, at the last 7 days' pace</Hint>
        </Figure>
      </Figures>
    </Panel>
  );`,
});

/** Production vs testing: test traffic should stay a small share of the bill. */
export const SPEND_BY_SOURCE_CODE = widgetCode({
  summary: "Spend per bucket split into production, evaluations, simulations and experiments.",
  subtitle: "Check that test traffic stays a small share",
  source: "traces",
  recharts: MARKED_CHART_IMPORTS,
  parts: [NUMBERS, RATIO, DATES, CHART_STYLE, HEADLINE, MARKED_CHART, PIVOT, TRACES_LINK],
  components: `// key, label, colour and the trace origin the row opens.
const SOURCES = [
  ["production", "Production", C.teal, "application"],
  ["evaluations", "Evaluations", C.orange, "evaluation"],
  ["simulations", "Simulations", C.pink, "simulation"],
  ["experiments", "Experiments", "#9f7aea", "playground"],
  ["other", "Other", C.faint, undefined],
];

function SourceRow({ label, colour, cost, total, origin }) {
  const open = origin ? () => openTraces({ origin }) : undefined;
  return (
    <div onClick={open} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5,
      padding: "3px 0", cursor: open ? "pointer" : "default" }}>
      <span style={{ width: 8, height: 8, borderRadius: 4, background: colour }} />
      <span style={{ width: 84, fontWeight: 500 }}>{label}</span>
      <span style={{ flex: 1, height: 6, borderRadius: 3, background: C.muted }}>
        <span style={{ display: "block", height: "100%", borderRadius: 3, background: colour,
          width: ratio(cost, total) * 100 + "%" }} />
      </span>
      <span style={{ width: 36, textAlign: "right", color: C.subtle }}>
        {pct(ratio(cost, total), 0)}
      </span>
      <span style={{ width: 56, textAlign: "right", fontWeight: 500 }}>{usd(cost)}</span>
    </div>
  );
}`,
  queries: ["main"],
  body: `  if (main.data.length === 0) return <Panel><CallToAction /></Panel>;
  const costOf = (key) => main.data.filter((row) => row.source === key)
    .reduce((sum, row) => sum + num(row.cost), 0);
  const total = SOURCES.reduce((sum, [key]) => sum + costOf(key), 0);
  if (total === 0) return <Panel><Note>No spend in this period.</Note></Panel>;
  const shown = SOURCES.filter(([key]) => key !== "other" || costOf(key) > 0);
  const series = shown.filter(([key]) => costOf(key) > 0).map(([key, label, colour]) => ({
    key, label, colour, bars: true, stack: "spend",
  }));
  const test = total - costOf("production");
  return (
    <Panel>
      <Headline value={pct(test / total, 0)} label={"of " + usd(total) + " is test traffic"} />
      <MarkedChart points={pivot(main.data, "source", (row) => num(row.cost))} series={series}
        format={usd} />
      <div style={{ marginTop: 8 }}>
        {shown.map(([key, label, colour, origin]) => (
          <SourceRow key={key} label={label} colour={colour} cost={costOf(key)} total={total}
            origin={origin} />
        ))}
      </div>
    </Panel>
  );`,
});

/** Wasted spend: the money that bought nothing, line by line, biggest first. */
export const WASTE_CODE = widgetCode({
  summary: "Spend on failed runs, recovered retries and loops, each trace counted once.",
  subtitle: "Fix the line with the biggest price first",
  source: "traces",
  compactCallToAction: true,
  parts: [NUMBERS, RATIO, TABLE, HEADLINE, TRACES_LINK],
  queries: ["main"],
  body: `  const w = main.data[0] || {};
  const spend = num(w.spend);
  if (spend === 0) return <Panel><CallToAction /></Panel>;
  const lines = [
    { label: "Failed, not recovered", traces: num(w.failed_traces), cost: num(w.failed_cost),
      filter: { status: "error" } },
    { label: "Retries that recovered", traces: num(w.retry_traces), cost: num(w.retry_cost) },
    { label: "Loops", traces: num(w.loop_traces), cost: num(w.loop_cost) },
  ].toSorted((a, b) => b.cost - a.cost);
  const total = lines.reduce((sum, line) => sum + line.cost, 0);
  if (total === 0) return <Panel><Note>No wasted spend in this period.</Note></Panel>;
  const columns = [
    {
      header: "Wasted on",
      cell: (row) => (
        <span onClick={() => openTraces(row.filter)} style={{ cursor: "pointer" }}>{row.label}</span>
      ),
    },
    { header: "Traces", align: "right", cell: (row) => count(row.traces) },
    { header: "Share", align: "right", cell: (row) => pct(ratio(row.cost, total), 0) },
    { header: "Cost", align: "right", cell: (row) => <b>{usd(row.cost)}</b> },
  ];
  return (
    <Panel>
      <Headline value={usd(total)}
        label={"wasted, " + pct(total / spend, 0) + " of production spend"} />
      <Table columns={columns} rows={lines} />
    </Panel>
  );`,
});

/** Cost per call: the LLM part is measured; speech waits for vendor rates. */
export const COST_PER_CALL_CODE = widgetCode({
  summary:
    "LLM cost per call from traces; speech to text and text to speech wait for vendor rates.",
  subtitle: "Check the share speech takes before cutting model cost",
  source: "traces",
  recharts: MARKED_CHART_IMPORTS,
  parts: [NUMBERS, RATIO, DATES, CHART_STYLE, FIGURES, MARKED_CHART],
  queries: ["total", "trend"],
  body: `  const t = total.data[0] || {};
  const calls = num(t.calls);
  if (calls === 0) return <Panel><CallToAction /></Panel>;
  const points = trend.data.map((row) => ({
    x: bucketLabel(row.bucket),
    llm: ratio(num(row.cost), num(row.calls)),
  }));
  return (
    <Panel>
      <Figures>
        <Figure label="LLM per call" value={usd(ratio(num(t.cost), calls))}>
          <Hint>{count(calls)} calls</Hint>
        </Figure>
        <Figure label="Speech per call" value="Not priced">
          <Hint>Speech vendor rates are not in LangWatch yet</Hint>
        </Figure>
      </Figures>
      <div style={{ height: 8 }} />
      <MarkedChart points={points} format={usd}
        series={[{ key: "llm", label: "LLM cost per call", colour: C.teal }]} />
    </Panel>
  );`,
});

/** Cost per document: whether a model change made each document cheaper. */
export const COST_PER_DOCUMENT_CODE = widgetCode({
  summary: "Production cost per document, overall and per model, with model changes marked.",
  subtitle: "Compare it with the accuracy per field before moving more traffic",
  source: "models",
  recharts: MARKED_CHART_IMPORTS,
  parts: [NUMBERS, RATIO, DATES, CHART_STYLE, BARS, FIGURES, MARKED_CHART],
  queries: ["trend", "halves", "changes"],
  body: `  if (trend.data.length === 0) return <Panel><CallToAction /></Panel>;
  const models = new Map();
  const buckets = new Map();
  for (const row of trend.data) {
    const model = models.get(row.model) || { cost: 0, documents: 0 };
    model.cost += num(row.cost);
    model.documents += num(row.documents);
    models.set(row.model, model);
    const point = buckets.get(row.bucket) || { x: bucketLabel(row.bucket), cost: 0, documents: 0 };
    point[row.model] = ratio(num(row.cost), num(row.documents));
    point.cost += num(row.cost);
    point.documents += num(row.documents);
    buckets.set(row.bucket, point);
  }
  const points = [...buckets.values()].map((point) => ({
    ...point,
    all: ratio(point.cost, point.documents),
  }));
  const rows = [...models.entries()].map(([model, value]) => ({ model, ...value }));
  const cost = rows.reduce((sum, row) => sum + row.cost, 0);
  const documents = rows.reduce((sum, row) => sum + row.documents, 0);
  const cheapest = rows.toSorted((a, b) => ratio(a.cost, a.documents) - ratio(b.cost, b.documents))[0];
  const h = halves.data[0] || {};
  const first = ratio(num(h.first_cost), num(h.first_documents));
  const second = ratio(num(h.second_cost), num(h.second_documents));
  const series = [
    ...rows.map((row, index) => ({
      key: row.model, label: row.model, colour: colourFor(row.model, index), dashed: true,
    })),
    { key: "all", label: "all documents", colour: C.text },
  ];
  const markers = changes.data.filter((row) => row.kind === "model").map(markerOf);
  return (
    <Panel>
      <Figures>
        <Figure label="Cost per document" value={usd(ratio(cost, documents))}>
          <Hint>{count(documents)} documents</Hint>
        </Figure>
        <Figure label="Second half against the first"
          value={first > 0 ? signedPct(second / first - 1) : "No earlier data"}>
          <Hint>{usd(first)} to {usd(second)}</Hint>
        </Figure>
        <Figure label="Cheapest model" value={usd(ratio(cheapest.cost, cheapest.documents))}>
          <Hint>{cheapest.model}</Hint>
        </Figure>
      </Figures>
      <div style={{ height: 8 }} />
      <MarkedChart points={points} series={series} format={usd} markers={markers} />
    </Panel>
  );`,
});
