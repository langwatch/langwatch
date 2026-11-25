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
    "Your app's own spend plus automatic checks. Requests on a model with no price add " +
    "nothing, so totals read low.",
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
  // No budget is known here: the pace counts as a problem when spend rose 10% or more.
  signalProblem(num(s.cost_prev) > 0 && cost >= num(s.cost_prev) * 1.1);
  return (
    <Panel>
      <Figures>
        <Figure label="Spent" value={costFigure(spend, cost)}>
          <Change now={cost} before={num(s.cost_prev)} better="down" format={usd} />
        </Figure>
        <Figure label="Cost per resolved conversation"
          value={resolved > 0 ? usd(perSuccess) : "Not scored yet"}>
          {resolved > 0 ? (
            <Change now={perSuccess} before={ratio(num(s.cost_prev), num(o.resolved_prev))}
              better="down" format={usd} />
          ) : (
            <Hint onClick={() => LW.navigate("onlineEvaluations", {})}>
              Score how conversations end
            </Hint>
          )}
        </Figure>
        <Figure label={monthName + " forecast"} value={usd(forecast)}>
          <Hint>{usd(num(m.month_to_date))} so far, forecast at the pace of the last 7 days</Hint>
        </Figure>
      </Figures>
    </Panel>
  );`,
});

/**
 * The spend the Production vs testing card calls testing: its automatic checks, simulated tests,
 * and playground and workflows rows. Your app and the Other row are not tests. No test traffic
 * is nothing spent; test traffic with no known price is unknown, never $0.
 */
export const TESTING_SPEND = `const TESTING = ["evaluations", "simulations", "experiments"];
function testingSpend(costOf, total, tracesOf) {
  if (!known(total)) return null;
  const spent = add(...TESTING.map((key) => costOf(key)));
  if (known(spent)) return spent;
  return TESTING.some((key) => tracesOf(key) > 0) ? null : 0;
}`;

/** Production vs testing: test traffic should stay a small share of the bill. */
export const SPEND_BY_SOURCE_CODE = widgetCode({
  summary: "Spend per bucket split into production, evaluations, simulations and experiments.",
  subtitle:
    "Where your AI spend goes: your app in production, or tests. Testing should stay a small " +
    "share.",
  source: "traces",
  recharts: MARKED_CHART_IMPORTS,
  parts: [
    NUMBERS,
    TESTING_SPEND,
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
  ["production", "Your app", C.teal, "application"],
  ["evaluations", "Automatic checks", C.orange, "evaluation"],
  ["simulations", "Simulated tests", C.pink, "simulation"],
  ["experiments", "Playground and workflows", "#9f7aea", "playground"],
  ["other", "Other", C.faint, undefined],
];

// A source with no traces says so; one with traces but no price never shows $0.00.
function SourceRow({ label, colour, cost, total, traces, unpriced, unpricedCounted, origin }) {
  const open = origin && traces > 0 ? () => openTraces({ origin }) : undefined;
  // Zero-rate spans cost null but aren't unpriced (span-cost-metrics.ts); a null sum (inferred)
  // is 0 where unpriced is counted (flight-deck-costs-queries.ts:447). Not evaluations: their
  // evaluator runs add a constant 0 AS unpriced (flight-deck-costs-queries.ts:454). The figure,
  // bar and share read this one sum; a row with no priced trace keeps its null.
  const sum = unpricedCounted && unpriced < traces ? cost ?? 0 : cost;
  const share = ratio(sum, total);
  const figure = traces === 0 ? "Nothing ran"
    : costText({ sum, priced: unpriced < traces, unpriced: unpriced > 0 });
  return (
    <div onClick={open} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5,
      padding: "3px 0", cursor: open ? "pointer" : "default",
      color: traces === 0 ? C.faint : C.text }}>
      <span style={{ width: 8, height: 8, borderRadius: 4,
        background: traces === 0 ? "transparent" : colour, border: "1px solid " + colour }} />
      <span style={{ width: 84, fontWeight: 500 }}>{label}</span>
      <span style={{ flex: 1, height: 6, borderRadius: 3, background: C.muted }}>
        <span style={{ display: "block", height: "100%", borderRadius: 3, background: colour,
          width: (share ?? 0) * 100 + "%" }} />
      </span>
      <span style={{ width: 36, textAlign: "right", color: C.subtle }}>
        {traces === 0 ? "" : pct(share, 0)}
      </span>
      <span style={{ minWidth: 64, textAlign: "right", fontWeight: 500, whiteSpace: "nowrap" }}>
        {figure}
      </span>
    </div>
  );
}

function UnpricedRow({ traces }) {
  return (
    <div title={count(traces) + " requests ran on a model with no price, so their cost is unknown."}
      style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5, padding: "3px 0",
        color: C.subtle }}>
      <span style={{ width: 8, height: 8, borderRadius: 4, border: "1px solid " + C.faint }} />
      <span style={{ width: 84, fontWeight: 500 }}>Price unknown</span>
      <span style={{ flex: 1 }}>{count(traces)} requests on a model with no price</span>
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
  const test = testingSpend(costOf, total, tracesOf);
  // A large share: testing takes a quarter of the spend or more.
  signalProblem((ratio(test, total) ?? 0) >= 0.25);
  return (
    <Panel>
      <Headline value={pct(ratio(test, total), 0)} label="of AI spend goes on testing" />
      <div style={{ flex: 1, minHeight: 140, display: "flex", flexDirection: "column" }}>
        <MarkedChart points={points} series={series} format={usd} legendKind="source" />
      </div>
      <div style={{ marginTop: 8 }}>
        {shown.map(([key, label, colour, origin]) => (
          <SourceRow key={key} label={label} colour={colour} cost={costOf(key)} total={total}
            traces={tracesOf(key)} unpriced={unpricedOf(key)}
            unpricedCounted={key !== "evaluations"} origin={origin} />
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
    "Spend on requests that failed, retried or went in circles, so you can fix the most " +
    "expensive line first.",
  source: "traces",
  compactCallToAction: true,
  parts: [NUMBERS, COMPLETENESS, TABLE, HEADLINE, TRACES_LINK],
  queries: ["main"],
  body: `  const w = main.data[0] || {};
  const spend = num(w.spend);
  if (!spend) return <Panel><CallToAction /></Panel>;
  const lines = [
    { label: "Requests that failed", traces: num(w.failed_traces), cost: num(w.failed_cost),
      filter: { status: "error" } },
    { label: "Retries before it worked", traces: num(w.retry_traces), cost: num(w.retry_cost) },
    { label: "Going in circles", traces: num(w.loop_traces), cost: num(w.loop_cost) },
  ].toSorted((a, b) => b.cost - a.cost);
  const total = add(...lines.map((line) => line.cost));
  if (!total) {
    signalProblem(false);
    return <Panel><Note>No spend was wasted in this period.</Note></Panel>;
  }
  const columns = [
    {
      header: "Wasted on",
      cell: (row) => (
        <span onClick={(event) => { event.stopPropagation(); openTraces(row.filter); }}
          style={{ cursor: "pointer" }}>{row.label}</span>
      ),
    },
    { header: "Requests", align: "right", cell: (row) => count(row.traces) },
    { header: "Share", align: "right", cell: (row) => pct(ratio(row.cost, total), 0) },
    { header: "Cost", align: "right", cell: (row) => <b>{usd(row.cost)}</b> },
  ];
  signalProblem(total > 0);
  return (
    <Panel>
      <Headline value={usd(total) + plus(main)}
        label={"spent on requests that bought nothing, " + pct(total / spend, 0) +
          " of what your agent cost"} />
      <Table columns={columns} rows={lines}
        ask={(row) => (row.cost > 0 ? { kind: "line", label: row.label } : null)} />
    </Panel>
  );`,
});

/** Cost per call: the LLM part is measured; speech waits for vendor rates. */
export const COST_PER_CALL_CODE = widgetCode({
  summary:
    "LLM cost per call from traces; speech to text and text to speech wait for vendor rates.",
  subtitle:
    "Model cost per voice call, without speech costs yet and without calls on a model with no " +
    "price.",
  source: "traces",
  recharts: MARKED_CHART_IMPORTS,
  parts: [NUMBERS, DATES, CHART_STYLE, COMPLETENESS, FIGURES, BUCKETS, GAP_BRIDGE, MARKED_CHART],
  queries: ["total", "trend"],
  body: `  const t = total.data[0] || {};
  const calls = num(t.calls);
  if (!calls) return <Panel><CallToAction /></Panel>;
  const points = withBuckets(trend, ["cost", "calls"]).map((row) => ({
    x: bucketLabel(row.bucket), at: bucketStart(row.bucket),
    llm: ratio(num(row.cost), num(row.calls)),
  }));
  return (
    <Panel>
      <Figures>
        <Figure label="Model cost per call" value={usd(ratio(num(t.cost), calls * pricedShare(total)))}>
          <Hint>{count(calls)} calls</Hint>
        </Figure>
        <Figure label="Speech per call" value="Not priced">
          <Hint>Speech to text and text to speech are not included yet.</Hint>
        </Figure>
      </Figures>
      <div style={{ height: 8 }} />
      <MarkedChart points={points} format={usd} legendKind="part"
        series={[{ key: "llm", label: "Model cost per call", colour: C.teal }]} />
    </Panel>
  );`,
});

/** Cost per document: whether a model change made each document cheaper. */
export const COST_PER_DOCUMENT_CODE = widgetCode({
  summary: "Production cost per document, overall and per model, with model changes marked.",
  subtitle:
    "What one document costs to process. Check field accuracy before you move work to the " +
    "cheapest model.",
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
    .map((point) => ({ ...point, x: bucketLabel(point.bucket), at: bucketStart(point.bucket) }));
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
    { key: "all", label: "All documents", colour: C.text },
  ];
  const markers = changes.data.filter((row) => row.kind === "model").map(markerOf);
  signalProblem(first > 0 && known(second) && second > first * 1.05);
  return (
    <Panel>
      <Figures>
        <Figure label="Cost per document" value={usd(ratio(cost, documents))}>
          <Hint>{count(documents)} documents</Hint>
        </Figure>
        <Figure label="Trend"
          value={first > 0 && known(second) ? signedPct(second / first - 1)
            : "Nothing to compare with yet"}>
          <Hint>{usd(first)} earlier in this period, {usd(second)} lately</Hint>
        </Figure>
        <Figure label="Cheapest model" value={cheapest ? usd(perDocument(cheapest)) : GAP}>
          <Hint>{cheapest ? cheapest.model : "No model has a price"}</Hint>
        </Figure>
      </Figures>
      <div style={{ height: 8 }} />
      <MarkedChart points={points} series={series} format={usd} markers={markers}
        legendKind="model" />
    </Panel>
  );`,
});
