/**
 * Stored TSX for the Running costs board (Spend, Production vs testing, Wasted spend) and its
 * use-case cost cards (Cost per call with speech vendors, Cost per document), each drawing what
 * Rogerio's prototype card computes. Every dollar is a sum of trace and evaluator cost.
 */

import {
  BARS,
  BUCKETS,
  CHART_STYLE,
  COMPLETENESS,
  DATES,
  GAP_BRIDGE,
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
  TRACES_LINK,
} from "./flight-deck-costs-parts.ts";

/** Spend: whether the month stays within what the team expects to pay. */
export const SPEND_CODE = widgetCode({
  summary:
    "Spend against the period before, cost per resolved conversation and the month forecast.",
  subtitle:
    "Production, evaluations and simulations together. Spend with traces on a model with no " +
    "price is a lower bound, marked +; the forecast runs at the pace of the last 7 days with data",
  source: "traces",
  compactCallToAction: true,
  parts: [NUMBERS, COMPLETENESS, FIGURES],
  queries: ["spend", "outcomes", "month"],
  body: `  const s = spend.data[0] || {};
  const o = outcomes.data[0] || {};
  const m = month.data[0] || {};
  const cost = num(s.cost);
  if (!cost && !num(s.conversations)) return <Panel><CallToAction /></Panel>;
  const resolved = num(o.resolved);
  const perSuccess = ratio(cost, resolved * pricedShare(spend));
  const daysLeft = num(m.days_in_month) - num(m.day_of_month);
  const pace = ratio(m.last_7_days, m.days_with_data);
  const forecast = add(m.month_to_date, known(pace) ? pace * daysLeft : null);
  const monthName = new Date().toLocaleString("en-US", { month: "long", timeZone: "UTC" });
  return (
    <Panel>
      <Figures>
        <Figure label="Spent" value={usd(cost) + plus(spend)}>
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
  subtitle:
    "Check that test traffic stays a small share. A source with no traces reads No runs; " +
    "traces on a model with no price add to the Unpriced row",
  source: "traces",
  recharts: MARKED_CHART_IMPORTS,
  parts: [
    NUMBERS,
    DATES,
    CHART_STYLE,
    HEADLINE,
    BUCKETS,
    GAP_BRIDGE,
    MARKED_CHART,
    PIVOT,
    TRACES_LINK,
  ],
  components: `// key, label, colour and the trace origin the row opens.
const SOURCES = [
  ["production", "Production", C.teal, "application"],
  ["evaluations", "Evaluations", C.orange, "evaluation"],
  ["simulations", "Simulations", C.pink, "simulation"],
  ["experiments", "Experiments", "#9f7aea", "playground"],
  ["other", "Other", C.faint, undefined],
];

// A source with no traces says so; one with traces but no price shows a dash, never $0.00.
function SourceRow({ label, colour, cost, total, traces, unpriced, origin }) {
  const open = origin && traces > 0 ? () => openTraces({ origin }) : undefined;
  const figure = traces === 0 ? "No runs" : usd(cost) + (unpriced > 0 && known(cost) ? "+" : "");
  return (
    <div onClick={open} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5,
      padding: "3px 0", cursor: open ? "pointer" : "default",
      color: traces === 0 ? C.faint : C.text }}>
      <span style={{ width: 8, height: 8, borderRadius: 4,
        background: traces === 0 ? "transparent" : colour, border: "1px solid " + colour }} />
      <span style={{ width: 84, fontWeight: 500 }}>{label}</span>
      <span style={{ flex: 1, height: 6, borderRadius: 3, background: C.muted }}>
        <span style={{ display: "block", height: "100%", borderRadius: 3, background: colour,
          width: (ratio(cost, total) ?? 0) * 100 + "%" }} />
      </span>
      <span style={{ width: 36, textAlign: "right", color: C.subtle }}>
        {traces === 0 ? "" : pct(ratio(cost, total), 0)}
      </span>
      <span style={{ width: 64, textAlign: "right", fontWeight: 500 }}>{figure}</span>
    </div>
  );
}

function UnpricedRow({ traces }) {
  return (
    <div title={count(traces) + " traces ran on a model with no price, so their cost is unknown."}
      style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5, padding: "3px 0",
        color: C.subtle }}>
      <span style={{ width: 8, height: 8, borderRadius: 4, border: "1px solid " + C.faint }} />
      <span style={{ width: 84, fontWeight: 500 }}>Unpriced</span>
      <span style={{ flex: 1 }}>{count(traces)} traces, no price</span>
      <span style={{ width: 64, textAlign: "right" }}>{GAP}</span>
    </div>
  );
}`,
  queries: ["main"],
  body: `  if (main.data.length === 0) return <Panel><CallToAction /></Panel>;
  const of = (key, column) => main.data.filter((row) => row.source === key).map((row) => row[column]);
  const costOf = (key) => add(...of(key, "cost"));
  const tracesOf = (key) => add(...of(key, "traces")) ?? 0;
  const unpricedOf = (key) => add(...of(key, "unpriced")) ?? 0;
  const total = add(...SOURCES.map(([key]) => costOf(key)));
  const unpriced = add(...SOURCES.map(([key]) => unpricedOf(key))) ?? 0;
  const shown = SOURCES.filter(([key]) => key !== "other" || tracesOf(key) > 0);
  const series = shown.filter(([key]) => costOf(key) > 0).map(([key, label, colour]) => ({
    key, label, colour, bars: true, stack: "spend",
  }));
  const spend = pivot(main.data, "source", (row) => num(row.cost));
  const points = labelled(withBuckets(main,
    series.map((item) => ({ key: item.key, kind: "count" })), spend));
  const test = known(total) ? total - (costOf("production") ?? 0) : null;
  return (
    <Panel>
      <Headline value={pct(ratio(test, total), 0)} label="test traffic" />
      <MarkedChart points={points} series={series} format={usd} />
      <div style={{ marginTop: 8 }}>
        {shown.map(([key, label, colour, origin]) => (
          <SourceRow key={key} label={label} colour={colour} cost={costOf(key)} total={total}
            traces={tracesOf(key)} unpriced={unpricedOf(key)} origin={origin} />
        ))}
        {unpriced > 0 ? <UnpricedRow traces={unpriced} /> : null}
      </div>
    </Panel>
  );`,
});

/** Wasted spend: the money that bought nothing, line by line, biggest first. */
export const WASTE_CODE = widgetCode({
  summary: "Spend on failed runs, recovered retries and loops, each trace counted once.",
  subtitle:
    "Fix the line with the biggest price first. Traces on a model with no price add no cost, " +
    "so a total marked + can only grow",
  source: "traces",
  compactCallToAction: true,
  parts: [NUMBERS, COMPLETENESS, TABLE, HEADLINE, TRACES_LINK],
  queries: ["main"],
  body: `  const w = main.data[0] || {};
  const spend = num(w.spend);
  if (!spend) return <Panel><CallToAction /></Panel>;
  const lines = [
    { label: "Failed, not recovered", traces: num(w.failed_traces), cost: num(w.failed_cost),
      filter: { status: "error" } },
    { label: "Retries that recovered", traces: num(w.retry_traces), cost: num(w.retry_cost) },
    { label: "Loops", traces: num(w.loop_traces), cost: num(w.loop_cost) },
  ].toSorted((a, b) => b.cost - a.cost);
  const total = add(...lines.map((line) => line.cost));
  if (!total) return <Panel><Note>No wasted spend in this period.</Note></Panel>;
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
      <Headline value={usd(total) + plus(main)}
        label={"wasted, " + pct(total / spend, 0) + " of production spend"} />
      <Table columns={columns} rows={lines} />
    </Panel>
  );`,
});

/** Cost per call: the LLM part is measured; speech waits for vendor rates. */
export const COST_PER_CALL_CODE = widgetCode({
  summary:
    "LLM cost per call from traces; speech to text and text to speech wait for vendor rates.",
  subtitle:
    "Check the share speech takes before cutting model cost. LLM per call counts only the calls " +
    "with a known price",
  source: "traces",
  recharts: MARKED_CHART_IMPORTS,
  parts: [NUMBERS, DATES, CHART_STYLE, COMPLETENESS, FIGURES, BUCKETS, GAP_BRIDGE, MARKED_CHART],
  queries: ["total", "trend"],
  body: `  const t = total.data[0] || {};
  const calls = num(t.calls);
  if (!calls) return <Panel><CallToAction /></Panel>;
  const points = withBuckets(trend, ["cost", "calls"]).map((row) => ({
    x: bucketLabel(row.bucket),
    llm: ratio(num(row.cost), num(row.calls)),
  }));
  return (
    <Panel>
      <Figures>
        <Figure label="LLM per call" value={usd(ratio(num(t.cost), calls * pricedShare(total)))}>
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
  parts: [NUMBERS, DATES, CHART_STYLE, BARS, FIGURES, BUCKETS, GAP_BRIDGE, MARKED_CHART],
  queries: ["trend", "halves", "changes"],
  body: `  if (trend.data.length === 0) return <Panel><CallToAction /></Panel>;
  const models = new Map();
  const buckets = new Map();
  for (const row of trend.data) {
    const model = models.get(row.model) || { cost: null, documents: 0 };
    model.cost = add(model.cost, row.cost);
    model.documents += num(row.documents);
    models.set(row.model, model);
    const point = buckets.get(row.bucket) || { bucket: row.bucket, cost: null, documents: 0 };
    point[row.model] = ratio(row.cost, row.documents);
    point.cost = add(point.cost, row.cost);
    point.documents += num(row.documents);
    buckets.set(row.bucket, point);
  }
  const perBucket = [...buckets.values()].map((point) => ({
    ...point,
    all: ratio(point.cost, point.documents),
  }));
  const points = withBuckets(trend, ["all", ...models.keys()], perBucket)
    .map((point) => ({ ...point, x: bucketLabel(point.bucket) }));
  const rows = [...models.entries()].map(([model, value]) => ({ model, ...value }));
  const cost = add(...rows.map((row) => row.cost));
  const documents = rows.reduce((sum, row) => sum + row.documents, 0);
  const perDocument = (row) => ratio(row.cost, row.documents);
  const cheapest = rows.filter((row) => known(perDocument(row)))
    .toSorted((a, b) => perDocument(a) - perDocument(b))[0];
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
          value={first > 0 && known(second) ? signedPct(second / first - 1) : "No earlier data"}>
          <Hint>{usd(first)} to {usd(second)}</Hint>
        </Figure>
        <Figure label="Cheapest model" value={cheapest ? usd(perDocument(cheapest)) : GAP}>
          <Hint>{cheapest ? cheapest.model : "No priced model"}</Hint>
        </Figure>
      </Figures>
      <div style={{ height: 8 }} />
      <MarkedChart points={points} series={series} format={usd} markers={markers} />
    </Panel>
  );`,
});
