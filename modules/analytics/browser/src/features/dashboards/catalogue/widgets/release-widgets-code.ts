/**
 * Stored TSX for "Release check": the newest test run against the ones before it,
 * flaky scenarios, the last runs side by side, production around the newest change,
 * models compared, test-set drift and field accuracy per test run.
 */

import {
  CHART_STYLE,
  DATES,
  NUMBERS,
  SERIES_CHART,
  SERIES_CHART_IMPORTS,
  STAT,
  TABLE,
  widgetCode,
} from "../../templates/model/widget-code-parts.ts";
import { FIELD_PRECISION_JUDGE, FIELD_RECALL_JUDGE } from "./release-queries.ts";
import { SETUP_NOTE } from "./setup-note.ts";

/** A coloured word for a verdict: worse, unclear, better, flaky and so on. */
const TAG = `function Tag({ tone, children }) {
  const color = { bad: C.red, warn: C.orange, good: C.green }[tone] || C.subtle;
  return (
    <span style={{ borderRadius: 6, padding: "1px 6px", fontSize: 10.5, fontWeight: 500, color,
      background: color + "1a", whiteSpace: "nowrap" }}>{children}</span>
  );
}`;

/** The 95% Wilson interval of a pass share, so a few runs do not read as certainty. */
const WILSON = `function wilson(passed, runs) {
  if (runs <= 0) return [0, 1];
  const z = 1.96;
  const share = passed / runs;
  const d = 1 + (z * z) / runs;
  const c = share + (z * z) / (2 * runs);
  const r = z * Math.sqrt((share * (1 - share)) / runs + (z * z) / (4 * runs * runs));
  return [Math.max(0, (c - r) / d), Math.min(1, (c + r) / d)];
}`;

/** An experiment widget's empty face: what it reads; no allowlisted page sets it up. */
const experimentFace = (line: string) =>
  `    return <Panel><SetupNote line={${JSON.stringify(line)}} /></Panel>;`;

/** A run's start as "Sep 7". */
const RUN_DAY = `const runDay = (value) =>
  utc(value).toLocaleDateString("en-US", { month: "short", day: "numeric" });`;

export const NEW_VERSION_CODE = widgetCode({
  summary:
    "The newest test run against the runs before it: pass rate, worse scenarios, time, cost.",
  subtitle: "Ship when no scenario got worse by more than its normal flakiness",
  source: "scenarios",
  parts: [NUMBERS, DATES, STAT],
  components: `${TAG}

${RUN_DAY}

// Worse or better only beyond the scenario's own flake rate; under 3 new runs it is unclear.
function classify(row) {
  const current = num(row.current_passed) / num(row.current_runs);
  const next = num(row.new_passed) / num(row.new_runs);
  const flake = Math.min(current, 1 - current);
  const delta = next - current;
  const few = flake > 0 && num(row.new_runs) < 3;
  if (Math.abs(delta) > flake + 1e-9) return few ? "Unclear" : delta < 0 ? "Worse" : "Better";
  return delta !== 0 && few ? "Unclear" : "Same";
}
const TONE = { Worse: "bad", Unclear: "warn", Better: "good" };`,
  queries: ["scenarios", "costs"],
  body: `  if (scenarios.data.length === 0) return <Panel><CallToAction /></Panel>;
  const rows = scenarios.data.map((row) => ({ ...row, verdict: classify(row) }));
  const sum = (key) => rows.reduce((total, row) => total + num(row[key]), 0);
  const newRate = sum("new_passed") / sum("new_runs");
  const currentRate = sum("current_passed") / sum("current_runs");
  const worse = rows.filter((row) => row.verdict === "Worse");
  const unclear = rows.filter((row) => row.verdict === "Unclear");
  const side = (isNew) => costs.data.find((row) => num(row.is_new) === (isNew ? 1 : 0)) || {};
  const next = side(true);
  const current = side(false);
  const slower = num(next.typical_ms) > num(current.typical_ms) * 1.25;
  const dearer = num(next.cost_per_run) > num(current.cost_per_run) * 1.1;
  let sentence = "The newest run can ship: no scenario got worse.";
  if (slower || dearer) sentence = "No scenario got worse, but check the " +
    (slower ? "run time" : "cost") + ".";
  if (worse.length > 0) sentence = "Hold the newest run: " + worse.length +
    (worse.length === 1 ? " scenario got" : " scenarios got") + " worse.";
  const listed = rows.filter((row) => row.verdict !== "Same").slice(0, 4);
  return (
    <Panel>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8,
        color: worse.length > 0 ? C.red : C.text }}>{sentence}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
        <Stat label={"Scenarios passed, " + pct(currentRate, 0) + " before"}
          value={pct(newRate, 0)} />
        <Stat label={"Scenarios worse" + (unclear.length > 0 ? ", " + unclear.length + " unclear" : "")}
          value={count(worse.length)} />
        <Stat label={"Typical run time, " + ms(num(current.typical_ms)) + " before"}
          value={ms(num(next.typical_ms))} />
        <Stat label={"Cost per run, " + usd(num(current.cost_per_run)) + " before"}
          value={usd(num(next.cost_per_run))} />
      </div>
      <div style={{ marginTop: 8, fontSize: 11.5 }}>
        {listed.map((row) => (
          <div key={row.scenario} style={{ display: "flex", alignItems: "center", gap: 8,
            padding: "3px 0", borderTop: "1px solid " + C.border }}>
            <Tag tone={TONE[row.verdict]}>{row.verdict}</Tag>
            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis",
              whiteSpace: "nowrap" }}>{row.name || row.scenario}</span>
            <span style={{ color: C.subtle }}>
              {pct(num(row.current_passed) / num(row.current_runs), 0)} to{" "}
              {pct(num(row.new_passed) / num(row.new_runs), 0)}
            </span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: "auto", fontSize: 10.5, color: C.faint }}>
        Newest run {next.started_at ? runDay(next.started_at) : ""}, against every earlier run
        of the same scenarios in this period
      </div>
    </Panel>
  );`,
});

export const FLAKY_TESTS_CODE = widgetCode({
  summary: "The last ten runs of each scenario as a strip of passes and fails, flaky ones first.",
  subtitle: "Fix or set aside the scenarios that flip",
  source: "scenarios",
  parts: [NUMBERS],
  components: `${TAG}

${WILSON}

// Flaky: passed and failed, and the interval cannot place it above 90% or below 10%.
function stability(row) {
  const passed = num(row.passed);
  const runs = num(row.runs);
  const [low, high] = wilson(passed, runs);
  if (runs < 3) return { label: "Few runs", tone: "warn", rank: 2 };
  if (passed > 0 && passed < runs && low < 0.9 && high > 0.1) {
    return { label: "Flaky", tone: "warn", rank: 0 };
  }
  if (passed / runs >= 0.5) return { label: "Stable", tone: "good", rank: 3 };
  return { label: "Fails", tone: "bad", rank: 1 };
}

function Strip({ strip }) {
  const slots = Array.from({ length: 10 }, (_, index) => strip[index - (10 - strip.length)]);
  return (
    <span style={{ display: "flex", gap: 2 }}>
      {slots.map((slot, index) => (
        <span key={index} style={{ width: 8, height: 8, borderRadius: 2,
          background: slot === undefined ? C.muted : slot === "1" ? C.green : C.red }} />
      ))}
    </span>
  );
}`,
  queries: ["main"],
  body: `  if (main.data.length === 0) return <Panel><CallToAction /></Panel>;
  const rows = main.data
    .map((row) => ({ ...row, stability: stability(row) }))
    .sort((a, b) => a.stability.rank - b.stability.rank ||
      num(a.passed) / num(a.runs) - num(b.passed) / num(b.runs));
  const flaky = rows.filter((row) => row.stability.label === "Flaky").length;
  const line = flaky > 0
    ? flaky + " of " + rows.length + " scenarios flip between runs."
    : "All " + rows.length + " scenarios give the same answer run after run.";
  return (
    <Panel>
      <div style={{ fontSize: 11.5, color: C.subtle, marginBottom: 6 }}>{line}</div>
      {rows.slice(0, 6).map((row) => (
        <div key={row.scenario} style={{ display: "flex", alignItems: "center", gap: 8,
          padding: "4px 0", borderTop: "1px solid " + C.border, fontSize: 11.5 }}>
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis",
            whiteSpace: "nowrap" }}>{row.name || row.scenario}</span>
          <Strip strip={String(row.strip)} />
          <span style={{ width: 36, textAlign: "right", fontSize: 10.5, color: C.faint }}>
            {num(row.passed)}/{num(row.runs)}
          </span>
          <Tag tone={row.stability.tone}>{row.stability.label}</Tag>
        </div>
      ))}
    </Panel>
  );`,
});

export const RUNS_COMPARED_CODE = widgetCode({
  summary: "The last five runs of the suite that ran last, side by side against the run before.",
  subtitle: "Scenarios passed, criteria met, cost and run time per run",
  source: "scenarios",
  compactCallToAction: true,
  parts: [NUMBERS, DATES, TABLE],
  components: `${RUN_DAY}

// better: which way is good; tolerance: a change smaller than this is no change.
const MEASURES = [
  { label: "Scenarios passed", better: 1, tolerance: 0.005, format: (value) => pct(value, 0),
    of: (run) => (num(run.scenarios) > 0 ? num(run.passed) / num(run.scenarios) : undefined) },
  { label: "Criteria met", better: 1, tolerance: 0.005, format: (value) => pct(value, 0),
    of: (run) => (num(run.criteria) > 0 ? num(run.met) / num(run.criteria) : undefined) },
  { label: "Cost per scenario", better: -1, tolerance: 0.0005, format: usd,
    of: (run) => num(run.cost_per_scenario) },
  { label: "Typical run time", better: -1, tolerance: 20, format: ms,
    of: (run) => num(run.typical_ms) },
];`,
  queries: ["main"],
  body: `  if (main.data.length === 0) return <Panel><CallToAction /></Panel>;
  const runs = main.data;
  const baseline = runs[Math.min(1, runs.length - 1)];
  const cell = (run) => (measure) => {
    const value = measure.of(run);
    if (value === undefined) return <span style={{ color: C.faint }}>n/a</span>;
    const base = measure.of(baseline);
    const delta = run === baseline || base === undefined ? 0 : (value - base) * measure.better;
    const color = delta > measure.tolerance ? C.green : delta < -measure.tolerance ? C.red : C.text;
    return <span style={{ color }}>{measure.format(value)}</span>;
  };
  const columns = [
    { header: "", cell: (measure) => <span style={{ color: C.subtle }}>{measure.label}</span> },
    ...runs.map((run, index) => ({
      header: runDay(run.started_at) + (run === baseline ? " · baseline" : "") + " #" + (index + 1),
      align: "right",
      cell: cell(run),
    })),
  ];
  return (
    <Panel>
      <Table columns={columns} rows={MEASURES} />
    </Panel>
  );`,
});

export const ROLLOUT_CODE = widgetCode({
  summary: "Production up to 7 days after the newest change against the same days a week before.",
  subtitle: "Roll back if production got worse after the change",
  source: "traces",
  parts: [NUMBERS, DATES, TABLE],
  components: `${RUN_DAY}

// better: which way is good; a relative change under 5% (1 point for rates) is no change.
function verdict({ before, after, better, rate }) {
  const change = rate ? after - before : before > 0 ? (after - before) / before : 0;
  const limit = rate ? 0.01 : 0.05;
  if (change * better > limit) return <span style={{ color: C.green }}>better</span>;
  if (change * better < -limit) return <span style={{ color: C.red }}>worse</span>;
  return <span style={{ color: C.faint }}>same</span>;
}`,
  queries: ["changes", "traffic", "checks"],
  body: `  if (changes.data.length === 0) {
    return <Panel><Note>No prompt or model change in this period to compare around.</Note></Panel>;
  }
  if (traffic.data.length === 0) return <Panel><CallToAction /></Panel>;
  const change = [...changes.data].sort((a, b) => String(a.at).localeCompare(String(b.at))).pop();
  const side = (after) => traffic.data.find((row) => num(row.after) === after) || {};
  const before = side(0);
  const after = side(1);
  const judged = checks.data[0] || {};
  const rows = [
    ...(num(judged.before_checks) > 0 && num(judged.after_checks) > 0 ? [{
      label: "Checks passed, topic mix evened out", better: 1, rate: true, format: pct,
      before: num(judged.before_rate), after: num(judged.after_even_rate),
    }] : []),
    { label: "Error rate", better: -1, rate: true, format: pct,
      before: num(before.error_rate), after: num(after.error_rate) },
    { label: "Response time, p95", better: -1, format: ms,
      before: num(before.p95_ms), after: num(after.p95_ms) },
    { label: "Cost per trace", better: -1, format: usd,
      before: num(before.cost_per_trace), after: num(after.cost_per_trace) },
  ];
  const columns = [
    { header: "", cell: (row) => <span style={{ color: C.subtle }}>{row.label}</span> },
    { header: "before", align: "right", cell: (row) => row.format(row.before) },
    { header: "after", align: "right", cell: (row) => <b>{row.format(row.after)}</b> },
    { header: "change", align: "right", cell: (row) => verdict(row) },
  ];
  return (
    <Panel>
      <div style={{ fontSize: 11.5, color: C.subtle, marginBottom: 6 }}>
        <b style={{ color: C.text }}>{change.label}</b>, {runDay(change.at)} · {count(num(after.traces))}
        {" "}traces after, {count(num(before.traces))} a week before
      </div>
      <Table columns={columns} rows={rows} />
    </Panel>
  );`,
});

/** Two setups whose pass rates are this close read as equally good. */
const EQUAL_MARGIN = 0.05;

export const MODELS_COMPARED_CODE = widgetCode({
  summary: "Pass rate, cost per test and p95 reply per model, from experiments that compared them.",
  subtitle: "Pick the cheapest model that holds quality",
  source: "scenarios",
  parts: [NUMBERS, TABLE],
  components: `${TAG}

${SETUP_NOTE}

const EQUAL_MARGIN = ${EQUAL_MARGIN};`,
  queries: ["main"],
  body: `  if (main.data.length === 0) {
${experimentFace("No experiment in this period ran two or more models side by side. Run one in Experiments to compare them here.")}
  }
  const best = num(main.data[0].pass_rate);
  const columns = [
    { header: "Model or setup", cell: (row) => (
      <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <span style={{ fontWeight: 500 }}>{row.setup}</span>
        {row === main.data[0] && <Tag tone="good">Best</Tag>}
        {row !== main.data[0] && best - num(row.pass_rate) <= EQUAL_MARGIN && (
          <Tag tone="good">As good</Tag>
        )}
      </span>
    ) },
    { header: "Tests passed", align: "right",
      cell: (row) => pct(num(row.pass_rate), 0) + " of " + count(num(row.graded)) },
    { header: "Cost per test", align: "right", cell: (row) => usd(num(row.cost_per_row)) },
    { header: "p95 reply", align: "right",
      cell: (row) => (row.p95_ms === null ? "n/a" : ms(num(row.p95_ms))) },
  ];
  return (
    <Panel>
      <Table columns={columns} rows={main.data} />
    </Panel>
  );`,
});

export const TEST_SET_DRIFT_CODE = widgetCode({
  summary: "Each test run's pass rate, and the same rate weighted to production's topic mix.",
  subtitle:
    "Trust the weighted figure before a release; a large gap means the test set is out of date",
  source: "scenarios",
  recharts: SERIES_CHART_IMPORTS,
  parts: [NUMBERS, DATES, CHART_STYLE, STAT, SERIES_CHART],
  components: `${RUN_DAY}\n\n${SETUP_NOTE}`,
  queries: ["main"],
  body: `  if (main.data.length === 0) {
${experimentFace("No experiment ran in this period. Run your test set as an experiment; the topics of its traces weight it to real traffic.")}
  }
  const runs = [...main.data].reverse();
  const latest = runs[runs.length - 1];
  const raw = num(latest.pass_rate);
  const weighted = num(latest.weighted_rate);
  const points = runs.map((run) => ({
    x: runDay(run.started_at),
    raw: num(run.pass_rate),
    weighted: num(run.weighted_rate),
  }));
  const series = [
    { key: "raw", label: "test set as run", colour: C.teal, bars: true },
    { key: "weighted", label: "weighted to real traffic", colour: C.orange, bars: true },
  ];
  return (
    <Panel>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8,
        marginBottom: 8 }}>
        <Stat label={"Latest run, " + count(num(latest.judged)) + " checks"} value={pct(raw, 0)} />
        <Stat label="Weighted to real traffic" value={pct(weighted, 0)} />
        <Stat label="Gap, test set against traffic"
          value={Math.round((raw - weighted) * 100) + " pts"} />
      </div>
      <SeriesChart points={points} series={series} format={(value) => pct(value, 0)} />
    </Panel>
  );`,
});

export const FIELD_ACCURACY_CODE = widgetCode({
  summary: "Field precision and recall of each of the last 12 test runs on labelled documents.",
  subtitle: "Hold a release that finds fewer fields",
  source: "scenarios",
  recharts: SERIES_CHART_IMPORTS,
  parts: [NUMBERS, DATES, CHART_STYLE, STAT, SERIES_CHART],
  components: `${RUN_DAY}\n\n${SETUP_NOTE}`,
  queries: ["main"],
  body: `  if (main.data.length === 0) {
${experimentFace(`No experiment run in this period has scores from evaluators named "${FIELD_PRECISION_JUDGE}" and "${FIELD_RECALL_JUDGE}", 0 to 1 per document.`)}
  }
  const runs = [...main.data].reverse();
  const last = runs[runs.length - 1];
  const previous = runs[runs.length - 2];
  const points = runs.map((run) => ({
    x: runDay(run.started_at),
    precision: num(run.precision_score),
    recall: num(run.recall_score),
  }));
  const series = [
    { key: "precision", label: "right when filled", colour: C.teal },
    { key: "recall", label: "found", colour: C.orange },
  ];
  const recallLabel = previous
    ? "Fields found, " + pct(num(previous.recall_score), 0) + " the run before"
    : "Fields found";
  return (
    <Panel>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8,
        marginBottom: 8 }}>
        <Stat label="Filled fields that are right" value={pct(num(last.precision_score), 0)} />
        <Stat label={recallLabel} value={pct(num(last.recall_score), 0)} />
        <Stat label="Labelled documents" value={count(num(last.documents))} />
      </div>
      <SeriesChart points={points} series={series} format={(value) => pct(value, 0)} />
    </Panel>
  );`,
});
