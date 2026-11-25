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
import { HEALTH_FIELDS } from "./trust-queries.ts";

/** A share in whole percents, with one decimal under 10% so a small share never reads 0%. */
export const SHARE_PCT = `const share = (value) => pct(value, known(value) && value !== 0 && Math.abs(value) < 0.1 ? 1 : 0);`;

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
  readonly unlocks: readonly string[];
}

/**
 * What the data completeness card says, from the coverage rows (dashboards-v2 AC166 to AC166e):
 * plain JS over `NUMBERS`, `SHARE_PCT` and `FIELDS`, so a test runs it as the frame does.
 */
export const HEALTH_REPORT = `// Green at or above WHOLE, orange at or above FAIR, red below; optional rows are never red.
const WHOLE = 0.99;
const FAIR = 0.9;
// A project where this share of requests carries a conversation or user id is a chat agent.
const CHAT_PRESENCE = 0.05;
const whole = (value) => (known(value) ? Math.round(num(value)).toLocaleString("en-US") : GAP);
const NOTES = {
  model: (gap) => "Missing on " + whole(gap.missing) + " of " + whole(gap.base) +
    " requests that call a model.",
  conversation: (gap) => "Without it, conversation length, resolved rate and cost per " +
    "conversation count each of these " + whole(gap.missing) + " messages on its own.",
  user: (gap) => "Without it, you can't see who sent these " + whole(gap.missing) +
    " requests or who comes back.",
  labels: () => "Split cards by customer, team or feature.",
  outcome: () => "See which conversations were resolved.",
};
const CHAT_EXTRAS = {
  conversation: "Send it if people chat with your agent, to count whole conversations.",
  user: "Send it to see who uses your agent and who comes back.",
};
const ONE_GAP = {
  model: (gap) => "Your agent does not send the model name on " + share(gap.gap) +
    " of requests that call a model",
  cost: (gap) => "Cost is missing on " + share(gap.gap) + " of requests that call a model",
  conversation: (gap) => "Your agent does not send a conversation id on " + share(gap.gap) +
    " of requests",
  user: (gap) => "Your agent does not send a user id on " + share(gap.gap) + " of requests",
};
const SOURCES_LINE = "This counts your app's own requests, leaving out tests and playground.";

function costNote(row, tokens, price, model) {
  const causes = [
    ...(tokens > 0 ? [whole(tokens) + " send no token counts"] : []),
    ...(price > 0 ? [whole(price) + " use a model with no price" +
      (model ? ', such as "' + model + '"' : "")] : []),
  ];
  return "Cost is missing on " + whole(row.missing) + " of " + whole(row.base) +
    " requests that call a model" + (causes.length > 0 ? ": " + causes.join(", ") : "") + ".";
}

function askFor(key, row) {
  if (key === "model") return { kind: "field", value: "model",
    label: whole(row.missing) + " of my agent's " + whole(row.base) +
      " requests that call a model" };
  if (key === "cost") return row.tokens > 0 ? { kind: "field", value: "cost",
    label: whole(row.tokens) + " of my agent's requests that call a model" } : null;
  return { kind: "field", value: key, label: row.label };
}

function healthReport(result, unpricedModel) {
  const by = Object.fromEntries(result.map((row) => [row.field, row]));
  const total = num(by.all?.base);
  if (!(total > 0)) return null;
  const read = (key) => {
    const row = by[key] || {};
    const base = num(row.base) ?? 0;
    const present = num(row.present) ?? 0;
    return { base, present, missing: Math.max(0, base - present), example: row.example || "",
      value: ratio(present, base) };
  };
  const chat = ["conversation", "user"].some((key) => read(key).value >= CHAT_PRESENCE);
  const rows = FIELDS.map((field) => {
    const counts = read(field.key);
    const optional = field.key === "labels" || field.key === "outcome" ||
      ((field.key === "conversation" || field.key === "user") && !chat);
    const group = optional ? "optional"
      : field.key === "model" || field.key === "cost" ? "every" : "chat";
    const value = counts.value;
    const tone = !known(value) || value >= WHOLE ? "green"
      : optional ? "optional" : value >= FAIR ? "orange" : "red";
    const row = { ...field, ...counts, group, tone, gap: known(value) ? 1 - value : null,
      tokens: field.key === "cost" ? read("no_tokens").present : 0,
      price: field.key === "cost" ? read("no_price").present : 0,
      priceModel: field.key === "cost" && read("no_price").present > 0 ? unpricedModel || ""
        : "" };
    const gapped = tone !== "green";
    row.note = !gapped ? ""
      : field.key === "cost" ? costNote(row, row.tokens, row.price, row.priceModel)
      : optional && CHAT_EXTRAS[field.key] ? CHAT_EXTRAS[field.key]
      : NOTES[field.key](row);
    row.ask = gapped ? askFor(field.key, row) : null;
    row.docs = gapped && field.key !== "model" && field.key !== "cost";
    return row;
  });
  const gaps = rows.filter((row) => row.tone === "red" || row.tone === "orange");
  const missingExtras = rows.filter((row) => row.group === "optional" && row.tone !== "green");
  const widest = Math.max(...gaps.map((row) => row.gap));
  const sameShare = gaps.every((row) => share(row.gap) === share(widest));
  const names = gaps.map((row, index) => index === 0 ? row.label
    : row.label.charAt(0).toLowerCase() + row.label.slice(1));
  const listed = names.length > 1
    ? names.slice(0, -1).join(", ") + " and " + names[names.length - 1] : names[0];
  const headline = gaps.length === 0
    ? { title: "Your agent sends everything the dashboards need",
        line: missingExtras.length > 0
          ? "Sending " + missingExtras.length + " optional " +
            (missingExtras.length === 1 ? "extra" : "extras") + " would add more answers."
          : "Every card can answer from your data in this period." }
    : gaps.length === 1
      ? { title: ONE_GAP[gaps[0].key](gaps[0]) + ".",
          line: "Without it some cards are empty or count less. " + SOURCES_LINE }
      : { title: gaps.length > 3 ? "Your agent's data is missing " + gaps.length + " things"
          : listed + " are missing on " + (sameShare ? "" : "up to ") + share(widest) +
            " of requests",
          line: "Without them some cards are empty or count less. " + SOURCES_LINE };
  const conversation = rows.find((row) => row.key === "conversation");
  const user = rows.find((row) => row.key === "user");
  const neither = read("neither");
  // One line for one group of requests that carries neither id, instead of two stories.
  const sharedGap = chat && [conversation, user].every((row) => row.tone === "red" ||
      row.tone === "orange") && neither.present > 0 &&
    neither.present >= 0.9 * Math.min(conversation.missing, user.missing);
  const shared = sharedGap ? { example: neither.example,
    line: "The same " + share(ratio(neither.present, total)) + " of requests carry neither a " +
      "conversation id nor a user id, which may be a different part of your app." } : null;
  const calls = read("model").base;
  const noCalls = total - calls > 0 && rows.some((row) => row.group === "every" && row.note)
    ? "Requests that made no model call (" + whole(total - calls) + ") are left out of " +
      "these two rows." : "";
  return { rows, gaps, headline, shared, noCalls, problem: gaps.length > 0 };
}`;

const HEALTH_GROUPS = [
  { key: "every", title: "Every agent" },
  { key: "chat", title: "Chat agents" },
  { key: "optional", title: "Optional: more ways to split your dashboards" },
];

/** The data completeness card, given which built widgets read each field. */
export function dataHealthCode({
  unlocks,
}: {
  unlocks: Readonly<Record<string, readonly string[]>>;
}): WidgetCode {
  const fields: HealthRow[] = HEALTH_FIELDS.map(({ key, label }) => ({
    key,
    label,
    unlocks: unlocks[key] ?? [],
  }));
  return widgetCode({
    summary:
      "Each field the dashboards read, counted against the requests it applies to, with what " +
      "to do about each gap.",
    subtitle:
      "Checks that your agent's data carries what the dashboards read. Model name and cost " +
      "count only requests that call a model; conversation id and user id show for agents " +
      "people chat with.",
    parts: [NUMBERS, SHARE_PCT],
    components: `${ALL_GOOD}

const FIELDS = ${JSON.stringify(fields, null, 2)};
const GROUPS = ${JSON.stringify(HEALTH_GROUPS)};
const TONES = { red: C.red, orange: C.orange, green: C.green, optional: C.faint };

${HEALTH_REPORT}

const LINK = { border: 0, padding: 0, background: "none", color: C.teal, fontFamily: "inherit",
  fontSize: 11, fontWeight: 500, cursor: "pointer" };

function Actions({ row }) {
  const actions = [
    ...(row.ask && canAskLangy() ? [{ label: "Ask Langy to add it",
      run: () => askLangy(row.ask) }] : []),
    ...(row.docs ? [{ label: "Show me how", run: () => LW.navigate("metadataDocs", {}) }] : []),
    ...(row.priceModel ? [{ label: "Add a price for " + row.priceModel,
      run: () => LW.navigate("modelCosts", {}) }] : []),
    ...(row.price > 0 && !row.priceModel ? [{ label: "Add a price",
      run: () => LW.navigate("modelCosts", {}) }] : []),
    ...(row.example && row.group !== "optional" ? [{ label: "Open an example",
      run: () => LW.navigate("trace", { traceId: row.example }) }] : []),
  ];
  if (actions.length === 0) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 2 }}>
      {actions.map((action) => (
        <button key={action.label} type="button" style={LINK} onClick={action.run}>
          {action.label}
        </button>
      ))}
    </div>
  );
}

function FieldRow({ row }) {
  const optional = row.group === "optional";
  return (
    <div title={row.unlocks.length > 0 ? "Cards that need it:\\n" + row.unlocks.join("\\n")
      : undefined}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: 12 }}>
        <span style={{ flex: 1, minWidth: 0, fontWeight: 500 }}>{row.label}</span>
        <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums",
          color: optional ? C.subtle : TONES[row.tone] }}>
          {!known(row.value) ? "No model calls" : optional ? "Sent on " + share(row.value)
            : share(row.value)}
        </span>
      </div>
      {optional || !known(row.value) ? null : (
        <div style={{ height: 6, marginTop: 2, borderRadius: 3, background: C.muted }}>
          <div style={{ height: "100%", borderRadius: 3, opacity: 0.8,
            width: Math.min(1, row.value) * 100 + "%", background: TONES[row.tone] }} />
        </div>
      )}
      {row.note ? <div style={{ marginTop: 2, fontSize: 11, color: C.subtle }}>{row.note}</div>
        : null}
      <Actions row={row} />
    </div>
  );
}`,
    queries: ["fields", "models"],
    body: `  const report = healthReport(fields.data, models.data[0]?.model);
  signalProblem(report?.problem === true);
  if (!report) return <Panel><Note>No requests in this period.</Note></Panel>;
  if (!report.problem && report.rows.every((row) => row.tone === "green")) {
    return (
      <Panel>
        <AllGood title={report.headline.title} line={report.headline.line} />
      </Panel>
    );
  }
  return (
    <Panel>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex",
        flexDirection: "column", gap: 8 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600 }}>{report.headline.title}</div>
          <div style={{ fontSize: 11.5, color: C.subtle }}>{report.headline.line}</div>
        </div>
        {report.shared ? (
          <div style={{ fontSize: 11.5, padding: "6px 8px", borderRadius: 6,
            background: C.muted }}>
            {report.shared.line}
            {report.shared.example ? (
              <button type="button" style={{ ...LINK, marginLeft: 8 }}
                onClick={() => LW.navigate("trace", { traceId: report.shared.example })}>
                Open an example
              </button>
            ) : null}
          </div>
        ) : null}
        {GROUPS.map((group) => {
          const rows = report.rows.filter((row) => row.group === group.key);
          if (rows.length === 0) return null;
          return (
            <div key={group.key} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: 0.4, color: C.faint,
                textTransform: "uppercase" }}>{group.title}</div>
              {rows.map((row) => <FieldRow key={row.key} row={row} />)}
              {group.key === "every" && report.noCalls ? (
                <div style={{ fontSize: 10.5, color: C.faint }}>{report.noCalls}</div>
              ) : null}
            </div>
          );
        })}
      </div>
    </Panel>
  );`,
  });
}

export const COST_ACCURACY_CODE = widgetCode({
  summary: "Traces with a model but no price per bucket, and the models with no known price.",
  subtitle:
    "Requests on a model LangWatch has no price for. Add a price for each model in Settings so " +
    "totals are complete.",
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
  signalProblem(withModel > 0 && unpriced > 0);
  if (!(withModel > 0)) {
    return (
      <Panel>
        <Note>
          No request in this period names its model, so none can be priced.
        </Note>
      </Panel>
    );
  }
  if (!(unpriced > 0)) {
    return (
      <Panel>
        <AllGood title="All costs priced"
          line="Every model your agent used in this period has a price." />
      </Panel>
    );
  }
  const counts = [{ key: "unpriced", kind: "count" }];
  const points = withBuckets(trend, counts).map((row) => ({
    x: bucketLabel(row.bucket), at: bucketStart(row.bucket),
    unpriced: num(row.unpriced),
  }));
  const series = [{ key: "unpriced", label: "Requests with no price", colour: C.orange, bars: true }];
  const unpricedModels = models.data.map((row) => ({ label: row.model, value: num(row.traces) }));
  return (
    <Panel>
      <Headline value={share(ratio(unpriced, withModel))}
        label="of model requests have no price, so your cost totals read low" />
      <SeriesChart points={points} series={series} format={count} />
      <div style={{ margin: "8px 0 4px", fontSize: 10.5, color: C.faint }}>
        Models with no price (add one to fix)
      </div>
      <Bars rows={unpricedModels} format={count} height={unpricedModels.length * 22}
        kind="model" />
    </Panel>
  );`,
});

export const NOISE_CODE = widgetCode({
  summary:
    "Traffic from tests, staging and the like, by source, with its share of traces and cost.",
  subtitle: "Requests from tests, staging or dev that would skew your other dashboards.",
  parts: [NUMBERS, SHARE_PCT, TABLE, HEADLINE],
  components: `${ALL_GOOD}

const ORIGIN_NAMES = {
  playground: "Playground",
  evaluation: "Automatic checks",
  simulation: "Simulated tests",
};
const sourceName = (source) => ORIGIN_NAMES[source] ||
  source.charAt(0).toUpperCase() + source.slice(1) + " setup";`,
  queries: ["sources"],
  body: `  const traffic = add(...sources.data.map((row) => row.traces));
  const spend = add(...sources.data.map((row) => row.cost));
  const noise = sources.data.filter((row) => row.source);
  // Tests and staging make a tenth of the requests or more.
  signalProblem(ratio(add(...noise.map((row) => row.traces)), traffic) >= 0.1);
  if (noise.length === 0) {
    return (
      <Panel>
        <AllGood title="No test traffic"
          line="Every request in this period came from production." />
      </Panel>
    );
  }
  const costShare = ratio(add(...noise.map((row) => row.cost)), spend);
  const label = "of requests are tests or staging" +
    (known(costShare) ? ", " + share(costShare) + " of cost" : "");
  const columns = [
    { header: "From", cell: (row) => sourceName(row.source) },
    { header: "Requests", align: "right", cell: (row) => count(row.traces) },
    { header: "Of requests", align: "right", cell: (row) => share(ratio(row.traces, traffic)) },
    { header: "Of cost", align: "right", cell: (row) => share(ratio(row.cost, spend)) },
  ];
  return (
    <Panel>
      <Headline value={share(ratio(add(...noise.map((row) => row.traces)), traffic))}
        label={label} />
      <Table columns={columns} rows={noise.slice(0, 4)} rowPadding={3}
        ask={(row) => ({ kind: "source", label: sourceName(row.source), value: row.source })} />
    </Panel>
  );`,
});
