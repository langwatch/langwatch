/**
 * The widgets of the boards preloaded for one agent kind: By customer, Call quality, Field
 * accuracy, Outputs users keep and Risk sign-off. Each reproduces a prototype card's answer
 * over the board's one period; the "unit" is whichever grouping key the project's traces carry.
 */

import { TRACE_COUNT_SQL } from "../../templates/model/question-queries.ts";
import { TABLE_ROWS } from "../../templates/model/template-widget.ts";
import {
  BARS,
  CHART_STYLE,
  DATES,
  HEADLINE,
  NUMBERS,
  SERIES_CHART,
  SERIES_CHART_IMPORTS,
  TABLE,
  widgetCode,
} from "../../templates/model/widget-code-parts.ts";
import * as sql from "./agent-kind-queries.ts";
import type { CatalogueWidgetBuild } from "./index.ts";

const UNIT_WORDS = Object.fromEntries(
  sql.UNIT_KEYS.map(({ attribute, one, many, things }) => [attribute, { one, many, things }]),
);

/** The unit's words from the attribute a query chose, and a unit value as a reader names it. */
const UNITS = `const UNITS = ${JSON.stringify(UNIT_WORDS)};
const unitOf = (key) => UNITS[key] || { one: "group", many: "groups", things: "conversations" };
const cap = (text) => text.charAt(0).toUpperCase() + text.slice(1);
const LANGUAGES = new Intl.DisplayNames(["en"], { type: "language" });
function unitName(value, key) {
  if (!value) return "No " + unitOf(key).one;
  if (key === "langwatch.customer_id") return value;
  if (key !== "metadata.language") return cap(value);
  try {
    return LANGUAGES.of(value) || value;
  } catch {
    return value;
  }
}
const NO_UNIT = "No trace in this period carries a customer id, labels or a grouping key " +
  "such as document_type in its metadata.";`;

/** A pass rate and whether it fell: enough judged on both sides, 2 points down, beyond chance. */
const PASS_RATES = `const MIN_JUDGED = 30;
const rate = (passed, judged) => (judged > 0 ? passed / judged : 0);
function worse(before, after) {
  if (before.judged < MIN_JUDGED || after.judged < MIN_JUDGED) return false;
  const drop = rate(before.passed, before.judged) - rate(after.passed, after.judged);
  const pooled = (before.passed + after.passed) / (before.judged + after.judged);
  const spread = Math.sqrt(pooled * (1 - pooled) * (1 / before.judged + 1 / after.judged));
  return drop >= 0.02 && spread > 0 && drop / spread >= 1.96;
}`;

/** Figure tiles: a label, the number, one line of context, red when it calls for action. */
const FIGURES = `const TONES = { act: C.red, watch: C.orange, good: C.green };
function Figure({ label, value, sub, tone }) {
  return (
    <div style={{ minWidth: 0, borderRadius: 6, background: C.muted, padding: "6px 8px" }}>
      <div style={{ fontSize: 10, color: C.faint }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 600, color: TONES[tone] || C.text,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</div>
      {sub ? <div style={{ fontSize: 10.5, color: C.subtle }}>{sub}</div> : null}
    </div>
  );
}
function Figures({ columns, children }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(" + columns + ", minmax(0, 1fr))",
      gap: 8, marginBottom: 8 }}>
      {children}
    </div>
  );
}`;

const SERIES_PARTS = [NUMBERS, DATES, CHART_STYLE, HEADLINE, SERIES_CHART, FIGURES];

const CHART = 6;

const ATT_SHARE_CODE = widgetCode({
  summary: "Conversations per customer (or other grouping key) and each one's share of all.",
  subtitle: "Who uses your agent most in this period",
  source: "requests",
  parts: [NUMBERS, UNITS],
  components: `const SHARE_GRID = { display: "grid", gridTemplateColumns: "9rem 1fr 4rem 3.5rem", gap: 8,
  alignItems: "center", fontVariantNumeric: "tabular-nums" };
function ShareRows({ rows, total, unit }) {
  const max = Math.max(...rows.map((row) => row.value), 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ ...SHARE_GRID, fontSize: 10.5, color: C.faint }}>
        <span>{cap(unit.one)}</span>
        <span />
        <span style={{ textAlign: "right" }}>{cap(unit.things)}</span>
        <span style={{ textAlign: "right" }}>Share</span>
      </div>
      {rows.map((row) => (
        <div key={row.label} style={{ ...SHARE_GRID, fontSize: 12 }}>
          <span style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis",
            whiteSpace: "nowrap" }}>{row.label}</span>
          <span style={{ height: 6, borderRadius: 3, background: C.muted }}>
            <span style={{ display: "block", height: "100%", borderRadius: 3, background: C.teal,
              width: (row.value / max) * 100 + "%" }} />
          </span>
          <span style={{ textAlign: "right" }}>{count(row.value)}</span>
          <span style={{ textAlign: "right", fontSize: 11, color: C.subtle }}>
            {total > 0 ? pct(row.value / total, 0) : "-"}
          </span>
        </div>
      ))}
    </div>
  );
}`,
  queries: ["units", "totals"],
  body: `  if (units.data.length === 0) return <Panel><CallToAction /></Panel>;
  const key = units.data[0].unit_key;
  if (!key) return <Panel><Note>{NO_UNIT}</Note></Panel>;
  const unit = unitOf(key);
  const total = num(totals.data[0]?.conversations);
  const more = num(totals.data[0]?.units) - Math.min(units.data.length, 6);
  const rows = units.data.slice(0, 6).map((row) => ({
    label: unitName(row.unit, key),
    value: num(row.conversations),
  }));
  return (
    <Panel>
      <ShareRows rows={rows} total={total} unit={unit} />
      {more > 0 ? (
        <div style={{ marginTop: 6, fontSize: 10.5, color: C.faint }}>
          {more} more {unit.many}
        </div>
      ) : null}
    </Panel>
  );`,
});

const ATT_TABLE_CODE = widgetCode({
  summary: "Per customer: conversations, judged pass rate against the period before, AI cost.",
  subtitle: "One row per customer or group; a red earlier pass rate fell beyond chance",
  source: "requests",
  parts: [NUMBERS, TABLE, UNITS, PASS_RATES],
  queries: ["units", "passRates"],
  body: `  if (units.data.length === 0) return <Panel><CallToAction /></Panel>;
  const key = units.data[0].unit_key;
  if (!key) return <Panel><Note>{NO_UNIT}</Note></Panel>;
  const unit = unitOf(key);
  const judged = new Map(passRates.data.map((row) => [row.unit, row]));
  const sides = (row) => {
    const verdicts = judged.get(row.unit) || {};
    return {
      now: { passed: num(verdicts.passed), judged: num(verdicts.judged) },
      before: { passed: num(verdicts.passed_before), judged: num(verdicts.judged_before) },
    };
  };
  const shown = (side) => (side.judged >= MIN_JUDGED ? pct(rate(side.passed, side.judged), 0) : "-");
  const perConversation = (row) =>
    num(row.conversations) > 0 ? usd(num(row.cost) / num(row.conversations)) : "-";
  const columns = [
    { header: cap(unit.one), cell: (row) => <b>{unitName(row.unit, key)}</b> },
    { header: cap(unit.things), align: "right", cell: (row) => count(num(row.conversations)) },
    { header: "Pass rate", align: "right", cell: (row) => shown(sides(row).now) },
    {
      header: "Before",
      align: "right",
      cell: (row) => {
        const { now, before } = sides(row);
        const fell = worse(before, now);
        return <span style={{ color: fell ? C.red : C.subtle }}>{shown(before)}</span>;
      },
    },
    { header: "AI cost", align: "right", cell: (row) => usd(num(row.cost)) },
    { header: "Per " + unit.things.slice(0, -1), align: "right", cell: perConversation },
  ];
  return (
    <Panel>
      <Table columns={columns} rows={units.data} rowPadding={3} />
      <div style={{ marginTop: 6, fontSize: 10.5, color: C.faint }}>
        Pass rates need {MIN_JUDGED} judged answers; "-" means fewer.
      </div>
    </Panel>
  );`,
});

const ATT_CHANGE_CODE = widgetCode({
  summary: "Each customer's judged pass rate on the newest prompt version against the one before.",
  subtitle: "Roll back or patch the ones the last change broke",
  source: "evaluations",
  parts: [NUMBERS, DATES, UNITS, PASS_RATES],
  components: `function ChangeRow({ label, before, after, fell, low }) {
  const at = (value) => ((value - low) / (1 - low)) * 100 + "%";
  const dot = (value, size, colour) => ({ position: "absolute", top: "50%", left: at(value),
    width: size, height: size, borderRadius: size, background: colour,
    transform: "translate(-50%, -50%)" });
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 10rem) 1fr 7rem", gap: 12,
      alignItems: "center", fontSize: 12, padding: "3px 0" }}>
      <span style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis",
        whiteSpace: "nowrap" }}>{label}</span>
      <span style={{ position: "relative", height: 12 }}>
        <span style={{ position: "absolute", top: "50%", width: "100%", height: 1,
          background: C.border }} />
        <span style={dot(before, 8, C.faint)} />
        <span style={dot(after, 10, fell ? C.red : C.teal)} />
      </span>
      <span style={{ textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums",
        color: fell ? C.red : C.subtle, fontWeight: fell ? 600 : 400 }}>
        {pct(before, 0)} to {pct(after, 0)}
      </span>
    </div>
  );
}`,
  queries: ["change", "units"],
  body: `  const last = change.data[0];
  if (!last) {
    return <Panel><Note>No new prompt version started in this period.</Note></Panel>;
  }
  if (units.data.length === 0) return <Panel><CallToAction /></Panel>;
  const key = units.data[0].unit_key;
  const sides = new Map();
  for (const row of units.data) {
    const side = row.version === last.version ? "after" : row.version === last.previous ? "before" : "";
    if (!side) continue;
    const entry = sides.get(row.unit) || {};
    entry[side] = { passed: num(row.passed), judged: num(row.judged) };
    sides.set(row.unit, entry);
  }
  const compared = [...sides.entries()]
    .filter(([, { before, after }]) => before && after)
    .filter(([, { before, after }]) => before.judged >= MIN_JUDGED && after.judged >= MIN_JUDGED)
    .map(([unit, { before, after }]) => ({
      label: unitName(unit, key),
      before: rate(before.passed, before.judged),
      after: rate(after.passed, after.judged),
      fell: worse(before, after),
    }));
  const fell = compared.filter((row) => row.fell);
  const shown = [...fell, ...compared.filter((row) => !row.fell)].slice(0, Math.max(6, fell.length));
  const low = Math.max(0, Math.min(...shown.flatMap((row) => [row.before, row.after]), 1) - 0.03);
  const day = utc(last.changed_at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const unit = unitOf(key);
  return (
    <Panel>
      <div style={{ display: "flex", gap: 8, alignItems: "baseline", marginBottom: 6, fontSize: 12 }}>
        <b>{last.previous} to {last.version}, from {day}</b>
        {compared.length > 0 ? (
          <span style={{ color: fell.length > 0 ? C.red : C.subtle }}>
            {fell.length > 0
              ? fell.length + " of " + compared.length + " " + unit.many + " got worse"
              : "All " + compared.length + " " + unit.many + " held"}
          </span>
        ) : null}
      </div>
      {shown.length === 0 ? (
        <Note>No {unit.one} has {MIN_JUDGED} judged answers on both versions yet.</Note>
      ) : (
        shown.map((row) => <ChangeRow key={row.label} {...row} low={low} />)
      )}
    </Panel>
  );`,
});

const COST_BY_SEGMENT_CODE = widgetCode({
  summary:
    "AI cost per customer (or other grouping key), top six, untagged traffic as its own row.",
  subtitle: "Check the ones that cost more than they bring",
  source: "models",
  parts: [NUMBERS, BARS, UNITS],
  queries: ["units", "totals"],
  body: `  const total = num(totals.data[0]?.cost);
  if (units.data.length === 0 || total === 0) return <Panel><CallToAction /></Panel>;
  const key = units.data[0].unit_key;
  if (!key) return <Panel><Note>{NO_UNIT}</Note></Panel>;
  const ranked = units.data.map((row) => ({ label: unitName(row.unit, key), value: num(row.cost) }));
  const rest = Math.max(0, total - ranked.reduce((sum, row) => sum + row.value, 0));
  const more = num(totals.data[0]?.units) - ranked.length;
  return (
    <Panel>
      <Bars rows={ranked} format={usd} />
      {more > 0 ? (
        <div style={{ marginTop: 6, fontSize: 10.5, color: C.faint }}>
          and {more} more {unitOf(key).many}, {usd(rest)}
        </div>
      ) : null}
    </Panel>
  );`,
});

/** The three stages of a voice reply, as the spans name them, with their chart colours. */
const STAGES = `const STAGES = [
  { key: "listening", label: "Speech to text", colour: C.teal },
  { key: "thinking", label: "Thinking", colour: C.orange },
  { key: "speaking", label: "Text to speech", colour: C.pink },
];`;

const VOICE_TURN_LATENCY_CODE = widgetCode({
  summary: "Slowest-5% reply time, split into speech to text, thinking and text to speech.",
  subtitle: "Shorten the stage that grew; first half of the period against the second",
  source: "spans",
  recharts: SERIES_CHART_IMPORTS,
  parts: [...SERIES_PARTS, STAGES],
  queries: ["trend", "summary"],
  body: `  const totals = summary.data[0] || {};
  if (num(totals.replies) === 0) return <Panel><CallToAction /></Panel>;
  const reply = num(totals.reply_p95);
  const stages = STAGES.map((stage) => ({
    ...stage,
    p95: num(totals[stage.key + "_p95"]),
    change: drift(num(totals[stage.key + "_first_p95"]), num(totals[stage.key + "_second_p95"])),
  }));
  const largest = stages.reduce((top, stage) => (stage.p95 > top.p95 ? stage : top));
  const grew = stages.reduce((top, stage) => (stage.change > top.change ? stage : top));
  const points = trend.data.map((row) => ({
    x: bucketLabel(row.bucket),
    ...Object.fromEntries(STAGES.map((stage) => [stage.key, num(row[stage.key + "_p95"])])),
  }));
  return (
    <Panel>
      <Figures columns={3}>
        <Figure label="Reply time, slowest 5%" value={ms(reply)}
          sub={"over " + count(num(totals.replies)) + " replies"} />
        <Figure label="Largest stage" value={largest.label + " " + ms(largest.p95)}
          sub={reply > 0 ? pct(largest.p95 / reply, 0) + " of the reply time" : undefined} />
        <Figure label="Grew most, second half" value={grew.label + " " + signed(grew.change)}
          tone={grew.change > 0.15 ? "act" : undefined} />
      </Figures>
      <SeriesChart points={points} format={ms} series={STAGES} />
    </Panel>
  );`,
});

const VOICE_CALL_HEALTH_CODE = widgetCode({
  summary: "Per 1,000 calls: calls whose last turn ended on an error, and calls that repeated.",
  subtitle: "Open the calls behind a rise",
  source: "spans",
  recharts: SERIES_CHART_IMPORTS,
  parts: SERIES_PARTS,
  components: `const REPEAT_CHECK = "${sql.REPEAT_CHECK}";
const perK = (part, whole) => (whole > 0 ? (part / whole) * 1000 : 0);
const perKLabel = (value) => value.toFixed(1);`,
  queries: ["trend", "summary"],
  body: `  const totals = summary.data[0] || {};
  const calls = num(totals.calls);
  if (calls === 0) return <Panel><CallToAction /></Panel>;
  const checked = num(totals.repeat_checks) > 0;
  const first = perK(num(totals.dropped_first), num(totals.calls_first));
  const second = perK(num(totals.dropped_second), num(totals.calls_second));
  const change = drift(first, second);
  const points = trend.data.map((row) => ({
    x: bucketLabel(row.bucket),
    dropped: perK(num(row.dropped), num(row.calls)),
    repeating: perK(num(row.repeating), num(row.calls)),
  }));
  const series = [{ key: "dropped", label: "not ended", colour: C.red }];
  if (checked) series.push({ key: "repeating", label: "repeated sentences", colour: C.orange });
  return (
    <Panel>
      <Figures columns={3}>
        <Figure label="Calls not ended" value={count(num(totals.dropped))}
          sub={perKLabel(perK(num(totals.dropped), calls)) + " per 1k calls"} />
        <Figure label="Calls with a repeated sentence"
          value={checked ? count(num(totals.repeating)) : "-"}
          sub={checked
            ? perKLabel(perK(num(totals.repeating), calls)) + " per 1k calls"
            : "Add the " + REPEAT_CHECK} />
        <Figure label="Not ended, second half" value={first > 0 ? signed(change) : "-"}
          sub="against the first half" tone={change > 0.25 ? "act" : undefined} />
      </Figures>
      <SeriesChart points={points} format={perKLabel} series={series} />
    </Panel>
  );`,
});

/** The accuracy under which a cell turns red; no stored minimum exists to read instead. */
const FIELD_FLOOR = 0.9;

const EXT_FIELD_ACCURACY_CODE = widgetCode({
  summary: "Share of checked documents with each field right, per document type and overall.",
  subtitle: `Fields a check marked wrong at least once; red under ${FIELD_FLOOR * 100}%`,
  source: "evaluations",
  parts: [NUMBERS, TABLE, UNITS],
  components: `const FLOOR = ${FIELD_FLOOR};
const MIN_CHECKED = 30;
const fieldName = (field) => cap(field.replace(/_/g, " ").replace(/\\b(vat|po)\\b/g, (word) =>
  word.toUpperCase()));
function Accuracy({ wrong, checked }) {
  if (checked === 0) return <span style={{ color: C.faint }}>-</span>;
  const accuracy = 1 - wrong / checked;
  let colour = C.subtle;
  if (checked < MIN_CHECKED) colour = C.faint;
  else if (accuracy < FLOOR - 0.03) colour = C.red;
  else if (accuracy < FLOOR) colour = C.orange;
  return <span style={{ color: colour, fontWeight: colour === C.red ? 600 : 400 }}>
    {pct(accuracy, 0)}
  </span>;
}`,
  queries: ["checks", "wrong"],
  body: `  if (checks.data.length === 0) return <Panel><CallToAction /></Panel>;
  const key = checks.data[0].unit_key;
  const checkedIn = new Map(checks.data.map((row) => [row.unit, num(row.checked)]));
  const allChecked = checks.data.reduce((sum, row) => sum + num(row.checked), 0);
  if (wrong.data.length === 0) {
    return (
      <Panel>
        <Note color={C.green}>Every field right on all {count(allChecked)} documents checked</Note>
      </Panel>
    );
  }
  const units = checks.data.slice(0, 3).map((row) => row.unit);
  const misses = new Map();
  for (const row of wrong.data) {
    const byUnit = misses.get(row.field) || new Map();
    byUnit.set(row.unit, num(row.wrong));
    misses.set(row.field, byUnit);
  }
  const total = (byUnit) => [...byUnit.values()].reduce((sum, value) => sum + value, 0);
  const fields = [...misses.entries()]
    .sort((a, b) => total(b[1]) - total(a[1]))
    .slice(0, 6)
    .map(([field, byUnit]) => ({ field, byUnit }));
  const columns = [
    { header: "Field", cell: (row) => <b>{fieldName(row.field)}</b> },
    ...units.map((unit) => ({
      header: unitName(unit, key),
      align: "right",
      cell: (row) => <Accuracy wrong={row.byUnit.get(unit) || 0} checked={checkedIn.get(unit) || 0} />,
    })),
    {
      header: "All",
      align: "right",
      cell: (row) => <Accuracy wrong={total(row.byUnit)} checked={allChecked} />,
    },
  ];
  return (
    <Panel>
      <Table columns={columns} rows={fields} rowPadding={3} />
    </Panel>
  );`,
});

const EXT_HUMAN_REVIEW_CODE = widgetCode({
  summary: "Share of documents sent to a person per bucket, and the document type sent most.",
  subtitle: "Lower it by fixing the type that fails the field check",
  source: "requests",
  recharts: SERIES_CHART_IMPORTS,
  parts: [...SERIES_PARTS, UNITS],
  queries: ["trend", "summary", "byUnit"],
  body: `  const totals = summary.data[0] || {};
  if (num(totals.traces) === 0) return <Panel><CallToAction /></Panel>;
  const documents = num(totals.documents);
  if (documents === 0) {
    return (
      <Panel>
        <Note>No trace in this period reports sent_to_review or an outcome in its metadata.</Note>
      </Panel>
    );
  }
  const sent = num(totals.sent);
  const firstShare = num(totals.documents_first) > 0
    ? num(totals.sent_first) / num(totals.documents_first) : 0;
  const top = byUnit.data[0];
  const unit = top ? unitOf(top.unit_key) : unitOf("");
  const points = trend.data.map((row) => ({
    x: bucketLabel(row.bucket),
    share: num(row.documents) > 0 ? num(row.sent) / num(row.documents) : 0,
  }));
  return (
    <Panel>
      <Figures columns={3}>
        <Figure label="Sent to review" value={pct(sent / documents, 1)}
          sub={"was " + pct(firstShare, 1) + " in the first half"} />
        <Figure label={cap(unit.one) + " sent most"}
          value={top && num(top.sent) > 0 ? unitName(top.unit, top.unit_key) : "None"}
          sub={top && num(top.documents) > 0
            ? pct(num(top.sent) / num(top.documents), 0) + " of its documents" : undefined} />
        <Figure label="Sent to a person" value={count(sent)}
          sub={"of " + count(documents) + " documents"} />
      </Figures>
      <SeriesChart points={points} format={(value) => pct(value, 0)} domain={[0, "auto"]}
        series={[{ key: "share", label: "sent to review", colour: C.teal }]} />
    </Panel>
  );`,
});

const GEN_DROPOFF_CODE = widgetCode({
  summary: "Outputs generated, used and accepted as is; the biggest drop is the step to fix.",
  subtitle: "Outputs whose use your app reported in output_action",
  source: "requests",
  parts: [NUMBERS, HEADLINE],
  components: `function Step({ label, value, of, drop }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "8rem 1fr 4rem", gap: 8,
      alignItems: "center", fontSize: 12 }}>
      <span style={{ fontWeight: 500 }}>{label}</span>
      <span style={{ height: 14, borderRadius: 4, background: C.muted }}>
        <span style={{ display: "block", height: "100%", borderRadius: 4, background: C.teal,
          opacity: 0.8, width: (of > 0 ? (value / of) * 100 : 0) + "%" }} />
      </span>
      <span style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
        {count(value)}
        {drop === undefined ? null : (
          <div style={{ fontSize: 10.5, color: C.subtle }}>{pct(drop, 0)} drop</div>
        )}
      </span>
    </div>
  );
}`,
  queries: ["main"],
  body: `  const totals = main.data[0] || {};
  if (num(totals.traces) === 0) return <Panel><CallToAction /></Panel>;
  const generated = num(totals.generated);
  if (generated === 0) {
    return (
      <Panel>
        <Note>No trace in this period reports output_action in its metadata.</Note>
      </Panel>
    );
  }
  const steps = [
    { label: "Generated", value: generated },
    { label: "Kept or edited", value: num(totals.used) },
    { label: "Accepted as is", value: num(totals.accepted) },
  ].map((step, index, all) => ({
    ...step,
    drop: index === 0 ? undefined : 1 - step.value / Math.max(1, all[index - 1].value),
  }));
  const worst = steps.slice(1).reduce((top, step) => (step.drop > top.drop ? step : top));
  return (
    <Panel>
      <Headline value={pct(worst.drop, 0)} label={"biggest drop, at " + worst.label.toLowerCase()} />
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {steps.map((step) => <Step key={step.label} {...step} of={generated} />)}
      </div>
    </Panel>
  );`,
});

const SO_VERDICT_CODE = widgetCode({
  summary: "Guardrail coverage, risky answers flagged but not blocked, and the review backlog.",
  subtitle: "Sign off only when every figure is clear; this period against the one before",
  source: "evaluations",
  parts: [NUMBERS, FIGURES],
  queries: ["guardrails", "traffic", "backlog"],
  body: `  if (guardrails.data.length === 0) return <Panel><CallToAction /></Panel>;
  const traces = num(traffic.data[0]?.traces);
  const coverage = (row) => (traces > 0 ? Math.min(1, num(row.checked) / traces) : 0);
  const weakest = guardrails.data.reduce((low, row) => (coverage(row) < coverage(low) ? row : low));
  const lowest = coverage(weakest);
  const flagged = guardrails.data.reduce((sum, row) => sum + num(row.flagged), 0);
  const flaggedBefore = guardrails.data.reduce((sum, row) => sum + num(row.flagged_before), 0);
  const pending = num(backlog.data[0]?.pending);
  const pendingBefore = num(backlog.data[0]?.pending_before);
  const zone = (act, watch) => (act ? "act" : watch ? "watch" : undefined);
  const figures = [
    {
      label: "Checked by guardrails",
      value: pct(lowest, 0),
      sub: weakest.control + " checks the fewest of " + count(traces) + " traces",
      tone: traces >= 30 ? zone(lowest < 0.9, lowest < 0.99) : undefined,
      why: "guardrails miss part of the traffic",
    },
    {
      label: "Risky answers that got through",
      value: count(flagged),
      sub: "flagged, not blocked; " + count(flaggedBefore) + " the period before",
      tone: zone(flagged > flaggedBefore * 2 + 3, flagged > flaggedBefore * 1.25 + 1),
      why: "more risky answers got through",
    },
    {
      label: "Waiting for review",
      value: count(pending),
      sub: count(pendingBefore) + " at the start of the period",
      tone: zone(pending > pendingBefore * 1.5 + 20, pending > pendingBefore * 1.1 + 5),
      why: "the review queue is growing",
    },
  ];
  const blocking = figures.find((figure) => figure.tone === "act");
  return (
    <Panel>
      <div style={{ marginBottom: 8, fontSize: 14, fontWeight: 600,
        color: blocking ? C.red : C.green }}>
        {blocking ? "Not ready to sign: " + blocking.why + "." : "Ready to sign."}
      </div>
      <Figures columns={3}>
        {figures.map((figure) => <Figure key={figure.label} {...figure} />)}
      </Figures>
    </Panel>
  );`,
});

/** The minimum each policy check should stay above; no stored minimum exists to read instead. */
const POLICY_FLOOR = 0.9;

const SO_RUBRIC_CODE = widgetCode({
  summary: "Pass rate per judge with its 95% margin, against a 90% minimum, lowest first.",
  subtitle: `Hold the release on any check whose margin sits under ${POLICY_FLOOR * 100}%`,
  source: "evaluations",
  parts: [NUMBERS],
  components: `const FLOOR = ${POLICY_FLOOR};
const MIN_JUDGED = 30;
// The Wilson interval: where the true pass rate likely sits, given how many were judged.
function margin(passed, judged) {
  const z = 1.96;
  const share = passed / judged;
  const centre = (share + (z * z) / (2 * judged)) / (1 + (z * z) / judged);
  const half = (z / (1 + (z * z) / judged)) *
    Math.sqrt((share * (1 - share)) / judged + (z * z) / (4 * judged * judged));
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}
function Criterion({ name, passed, judged }) {
  const share = passed / judged;
  const [low, high] = margin(passed, judged);
  let colour = C.green;
  if (judged < MIN_JUDGED) colour = C.faint;
  else if (high < FLOOR) colour = C.red;
  else if (share < FLOOR) colour = C.orange;
  return (
    <div title={"Likely between " + pct(low, 0) + " and " + pct(high, 0) + ", from " +
      count(judged) + " judged"}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: 12 }}>
        <span style={{ flex: 1, minWidth: 0, fontWeight: 500, overflow: "hidden",
          textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name || "Unnamed"}</span>
        <span style={{ fontSize: 10.5, color: C.faint }}>
          {judged < MIN_JUDGED ? "only " + judged + " judged" : pct(low, 0) + " to " + pct(high, 0)}
        </span>
        <b style={{ color: colour, fontVariantNumeric: "tabular-nums" }}>{pct(share, 0)}</b>
      </div>
      <div style={{ position: "relative", height: 6, marginTop: 4, borderRadius: 3,
        background: C.muted }}>
        <span style={{ position: "absolute", left: pct(low, 1), width: pct(high - low, 1),
          height: "100%", borderRadius: 3, background: colour, opacity: 0.35 }} />
        <span style={{ position: "absolute", left: 0, width: pct(share, 1), height: "100%",
          borderRadius: 3, background: colour, opacity: 0.8 }} />
        <span style={{ position: "absolute", left: pct(FLOOR, 1), top: -2, width: 2, height: 10,
          background: C.text }} />
      </div>
    </div>
  );
}`,
  queries: ["main"],
  body: `  if (main.data.length === 0) return <Panel><CallToAction /></Panel>;
  return (
    <Panel>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {main.data.map((row) => (
          <Criterion key={row.criterion} name={row.criterion} passed={num(row.passed)}
            judged={num(row.judged)} />
        ))}
      </div>
    </Panel>
  );`,
});

const SO_QUEUE_CODE = widgetCode({
  summary: "Annotation queue items that came in, were reviewed and wait, with the typical wait.",
  subtitle: "Keep the pending count from growing",
  source: "feedback",
  recharts: SERIES_CHART_IMPORTS,
  parts: SERIES_PARTS,
  queries: ["summary", "flow"],
  body: `  const totals = summary.data[0] || {};
  const cameIn = num(totals.came_in);
  const pending = num(totals.pending);
  const before = num(totals.pending_before);
  if (cameIn + num(totals.reviewed) + pending === 0) return <Panel><CallToAction /></Panel>;
  const grew = pending - before;
  let backlog = before;
  const points = flow.data.map((row) => {
    backlog += num(row.came_in) - num(row.reviewed);
    return { x: bucketLabel(row.bucket), pending: backlog };
  });
  const wait = totals.wait_seconds === null ? "-" : Math.round(num(totals.wait_seconds) / 3600) + "h";
  let tone;
  if (grew > cameIn * 0.1) tone = "act";
  else if (grew > 0) tone = "watch";
  return (
    <Panel>
      <Figures columns={4}>
        <Figure label="Came in" value={count(cameIn)} />
        <Figure label="Reviewed" value={count(num(totals.reviewed))} />
        <Figure label="Pending now" value={count(pending)} tone={tone}
          sub={(grew >= 0 ? "+" : "") + count(grew) + " in the period"} />
        <Figure label="Typical wait" value={wait} />
      </Figures>
      <SeriesChart points={points} format={count}
        series={[{ key: "pending", label: "pending", colour: C.red }]} />
    </Panel>
  );`,
});

const SO_CHANGES_CODE = widgetCode({
  summary: "Prompt versions, new evaluators and changed online evaluations, newest first.",
  subtitle: "The audit trail for each release",
  source: "evaluations",
  parts: [NUMBERS, DATES, TABLE],
  queries: ["main"],
  body: `  if (main.data.length === 0) {
    return (
      <Panel>
        <Note>No prompt version, evaluator or online evaluation changed in this period.</Note>
      </Panel>
    );
  }
  const day = (value) =>
    utc(value).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const columns = [
    { header: "When", cell: (row) => <span style={{ color: C.faint }}>{day(row.at)}</span> },
    { header: "What", cell: (row) => row.kind },
    { header: "Name", cell: (row) => <b>{row.name || "Unnamed"}</b> },
  ];
  return (
    <Panel>
      <Table columns={columns} rows={main.data} rowPadding={3} />
    </Panel>
  );`,
});

/** The builds, keyed by catalogue widget id. */
export const AGENT_KIND_WIDGET_BUILDS: Readonly<Record<string, CatalogueWidgetBuild>> = {
  "att-share": {
    code: ATT_SHARE_CODE,
    queries: { units: sql.UNIT_VOLUME_SQL, totals: sql.UNIT_TOTALS_SQL },
    width: "half",
    rows: 5,
  },
  "att-table": {
    code: ATT_TABLE_CODE,
    queries: { units: sql.UNIT_VOLUME_SQL, passRates: sql.UNIT_PASS_RATES_SQL },
    width: "full",
    rows: TABLE_ROWS,
  },
  "att-change": {
    code: ATT_CHANGE_CODE,
    queries: { change: sql.LAST_CHANGE_SQL, units: sql.VERSION_PASS_RATES_SQL },
    width: "full",
    rows: 5,
  },
  "cost-by-segment": {
    code: COST_BY_SEGMENT_CODE,
    queries: { units: sql.UNIT_COST_SQL, totals: sql.UNIT_TOTALS_SQL },
    width: "half",
    rows: 5,
  },
  "voice-turn-latency": {
    code: VOICE_TURN_LATENCY_CODE,
    queries: { trend: sql.VOICE_STAGE_TREND_SQL, summary: sql.VOICE_STAGE_SUMMARY_SQL },
    width: "half",
    rows: CHART,
  },
  "voice-call-health": {
    code: VOICE_CALL_HEALTH_CODE,
    queries: { trend: sql.VOICE_CALL_TREND_SQL, summary: sql.VOICE_CALL_SUMMARY_SQL },
    width: "half",
    rows: CHART,
  },
  "ext-field-accuracy": {
    code: EXT_FIELD_ACCURACY_CODE,
    queries: { checks: sql.FIELD_CHECKS_SQL, wrong: sql.WRONG_FIELDS_SQL },
    width: "half",
    rows: TABLE_ROWS,
  },
  "ext-human-review": {
    code: EXT_HUMAN_REVIEW_CODE,
    queries: {
      trend: sql.REVIEW_TREND_SQL,
      summary: sql.REVIEW_SUMMARY_SQL,
      byUnit: sql.REVIEW_BY_UNIT_SQL,
    },
    width: "half",
    rows: CHART,
  },
  "gen-dropoff": {
    code: GEN_DROPOFF_CODE,
    queries: { main: sql.OUTPUT_ACTIONS_SQL },
    width: "half",
    rows: 4,
  },
  "so-verdict": {
    code: SO_VERDICT_CODE,
    queries: {
      guardrails: sql.GUARDRAILS_SQL,
      traffic: TRACE_COUNT_SQL,
      backlog: sql.REVIEW_BACKLOG_SQL,
    },
    width: "full",
    rows: 3,
  },
  "so-rubric": {
    code: SO_RUBRIC_CODE,
    queries: { main: sql.CRITERIA_SQL },
    width: "half",
    rows: 5,
  },
  "so-queue": {
    code: SO_QUEUE_CODE,
    queries: { summary: sql.QUEUE_SUMMARY_SQL, flow: sql.QUEUE_FLOW_SQL },
    width: "half",
    rows: 5,
  },
  "so-changes": {
    code: SO_CHANGES_CODE,
    queries: { main: sql.CHANGES_SQL },
    width: "half",
    rows: TABLE_ROWS,
  },
};
