/**
 * Stored TSX for "Can I trust my numbers?": how much of the traffic carries each field the
 * boards read, which traces have no price, and how much traffic is tests, staging and the like.
 */

import {
  BARS,
  BUCKETS,
  CHART_STYLE,
  DATES,
  GAP_BRIDGE,
  HEADLINE,
  NUMBERS,
  SERIES_CHART,
  SERIES_CHART_IMPORTS,
  TABLE,
  type WidgetCode,
  widgetCode,
} from "../../templates/model/widget-code-parts.ts";
import { SHARE_ROWS } from "./answers-asks-parts.ts";
import { HEALTH_FIELDS } from "./trust-queries.ts";

/** A share in whole percents, with one decimal under 10% so a small share never reads 0%. */
const SHARE_PCT = `const share = (value) => pct(value, known(value) && value !== 0 && Math.abs(value) < 0.1 ? 1 : 0);`;

/**
 * What a Trust widget shows with nothing to flag: a plain positive statement that fills the
 * card, so it never reads as broken. The (i) says how many traces were checked.
 */
const ALL_GOOD = `function AllGood({ title, line }) {
  return (
    <div style={{ flex: 1, ...CENTRED, gap: 8, textAlign: "center" }}>
      <div style={{ ...CENTRED, width: 40, height: 40, borderRadius: 20,
        background: C.green + "1f" }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={C.green}
          strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </div>
      <div style={{ fontSize: 15, fontWeight: 600 }}>{title}</div>
      <div style={{ fontSize: 12, color: C.subtle, maxWidth: 320 }}>{line}</div>
    </div>
  );
}`;

/** A field's place on the card: its words and the widgets that read it. */
export interface HealthRow {
  readonly key: string;
  readonly label: string;
  readonly send: string;
  readonly unlocks: readonly string[];
}

/** "Is my data complete?", given which built widgets read each field. */
export function dataHealthCode({
  unlocks,
}: {
  unlocks: Readonly<Record<string, readonly string[]>>;
}): WidgetCode {
  const fields: HealthRow[] = HEALTH_FIELDS.map(({ key, label, send }) => ({
    key,
    label,
    send,
    unlocks: unlocks[key] ?? [],
  }));
  return widgetCode({
    summary: "Share of traces that carry each field the boards read, and what sending it unlocks.",
    subtitle: "Send what is missing so every board can answer",
    parts: [NUMBERS, SHARE_PCT, HEADLINE, SHARE_ROWS],
    components: `${ALL_GOOD}

const FIELDS = ${JSON.stringify(fields, null, 2)};
// A share at or above this reads as every trace.
const WHOLE = 0.995;
const widgets = (n) => n + (n === 1 ? " widget" : " widgets");

function fieldRow(field, value) {
  const whole = known(value) && value >= WHOLE;
  const unlock = field.unlocks.length > 0 ? " to unlock " + widgets(field.unlocks.length) : "";
  return {
    label: field.label,
    figure: share(value),
    value: num(value) ?? 0,
    colour: whole ? C.green : num(value) >= 0.5 ? C.orange : C.red,
    note: whole ? "" : "Missing on " + share(1 - value) + ": send " + field.send + unlock + ".",
    title: field.unlocks.length > 0 ? "Sending it unlocks: " + field.unlocks.join("; ") : undefined,
  };
}`,
    queries: ["fields"],
    body: `  const traces = Object.fromEntries(fields.data.map((row) => [row.field, num(row.traces)]));
  const rows = FIELDS.map((field) => fieldRow(field, ratio(traces[field.key], traces.all)));
  const complete = rows.filter((row) => !row.note).length;
  if (complete === FIELDS.length) {
    return (
      <Panel>
        <AllGood title="Every field arrives"
          line="Each trace in this period carries a model, cost, user, conversation, labels and an outcome." />
      </Panel>
    );
  }
  return (
    <Panel>
      <Headline value={complete + " of " + FIELDS.length}
        label="fields are on every trace in this period" />
      <ShareRows rows={rows} />
    </Panel>
  );`,
  });
}

export const COST_ACCURACY_CODE = widgetCode({
  summary: "Traces with a model but no price per bucket, and the models with no known price.",
  subtitle: "Add a price for each model so cost totals stop reading low",
  recharts: SERIES_CHART_IMPORTS,
  parts: [
    NUMBERS,
    SHARE_PCT,
    DATES,
    CHART_STYLE,
    BUCKETS,
    GAP_BRIDGE,
    SERIES_CHART,
    HEADLINE,
    BARS,
  ],
  components: ALL_GOOD,
  queries: ["trend", "models"],
  body: `  const withModel = add(...trend.data.map((row) => row.with_model));
  const unpriced = add(...trend.data.map((row) => row.unpriced));
  if (!(withModel > 0)) {
    return <Panel><Note>No trace in this period names its model, so none can be priced.</Note></Panel>;
  }
  if (!(unpriced > 0)) {
    return (
      <Panel>
        <AllGood title="All costs priced"
          line="Every trace with a model in this period has a price." />
      </Panel>
    );
  }
  const counts = [{ key: "unpriced", kind: "count" }];
  const points = withBuckets(trend, counts).map((row) => ({
    x: bucketLabel(row.bucket),
    unpriced: num(row.unpriced),
  }));
  const series = [{ key: "unpriced", label: "traces with no price", colour: C.orange, bars: true }];
  const unpricedModels = models.data.map((row) => ({ label: row.model, value: num(row.traces) }));
  return (
    <Panel>
      <Headline value={share(ratio(unpriced, withModel))}
        label="of traces with a model have no price, so cost totals read low" />
      <SeriesChart points={points} series={series} format={count} />
      <div style={{ margin: "8px 0 4px", fontSize: 10.5, color: C.faint }}>
        Models with no price, by traces
      </div>
      <Bars rows={unpricedModels} format={count} height={unpricedModels.length * 22} />
    </Panel>
  );`,
});

export const NOISE_CODE = widgetCode({
  summary:
    "Traffic from tests, staging and the like, by source, with its share of traces and cost.",
  subtitle: "Filter test and staging traffic out before you read the other boards",
  parts: [NUMBERS, SHARE_PCT, TABLE, HEADLINE],
  components: `${ALL_GOOD}

const ORIGIN_NAMES = {
  playground: "Playground",
  evaluation: "Evaluations",
  simulation: "Simulations",
};
const sourceName = (source) => ORIGIN_NAMES[source] ||
  source.charAt(0).toUpperCase() + source.slice(1) + " environment";`,
  queries: ["sources"],
  body: `  const traffic = add(...sources.data.map((row) => row.traces));
  const spend = add(...sources.data.map((row) => row.cost));
  const noise = sources.data.filter((row) => row.source);
  if (noise.length === 0) {
    return (
      <Panel>
        <AllGood title="No test traffic"
          line="Nothing in this period comes from tests, staging and the like." />
      </Panel>
    );
  }
  const costShare = ratio(add(...noise.map((row) => row.cost)), spend);
  const label = "of traces come from tests, staging and the like" +
    (known(costShare) ? ", " + share(costShare) + " of cost" : "");
  const columns = [
    { header: "Source", cell: (row) => sourceName(row.source) },
    { header: "Traces", align: "right", cell: (row) => count(row.traces) },
    { header: "Of traffic", align: "right", cell: (row) => share(ratio(row.traces, traffic)) },
    { header: "Of cost", align: "right", cell: (row) => share(ratio(row.cost, spend)) },
  ];
  return (
    <Panel>
      <Headline value={share(ratio(add(...noise.map((row) => row.traces)), traffic))}
        label={label} />
      <Table columns={columns} rows={noise.slice(0, 4)} rowPadding={3} />
    </Panel>
  );`,
});
