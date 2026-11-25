/**
 * Stored TSX for the Flight Deck's cockpit cards (This period, Needs attention, Top request it
 * cannot serve, resolved per day) and its use-case cards (Task success, Accepted, edited or
 * regenerated), each drawing what Rogerio's prototype card computes.
 */

import {
  BARS,
  BUCKETS,
  CHART_STYLE,
  COMPLETENESS,
  DATES,
  GAP_BRIDGE,
  NUMBERS,
  SPENT_HINT,
  TRACE_LINK,
  TABLE,
  widgetCode,
} from "../../templates/model/widget-code-parts.ts";
import {
  FIGURES,
  MARKED_CHART,
  MARKED_CHART_IMPORTS,
  OUTCOME_EMPTY,
  PIVOT,
  SEEN_OR_SETUP,
  TRACES_LINK,
  WORDS,
} from "./flight-deck-costs-parts.ts";

/** This period: whether the agent does its job and what a success costs, at a glance. */
export const KPIS_CODE = widgetCode({
  summary: "How often my agent resolves, how much it is used, checks passing and cost per success.",
  subtitle:
    "Each figure against the previous period. Cost per resolved conversation leaves out " +
    "requests on a model with no price.",
  source: "traces",
  compactCallToAction: true,
  parts: [NUMBERS, COMPLETENESS, FIGURES],
  components: SPENT_HINT,
  queries: ["outcomes", "spend", "checks"],
  body: `  const o = outcomes.data[0] || {};
  const s = spend.data[0] || {};
  const k = checks.data[0] || {};
  const conversations = num(s.conversations);
  if (!conversations) return <Panel><CallToAction /></Panel>;
  const resolved = num(o.resolved);
  const resolvedPrev = num(o.resolved_prev);
  const perSuccess = ratio(num(s.cost), resolved * pricedShare(spend));
  // The previous period read with the same priced share, so an unpriced model moves neither.
  const perSuccessPrev = ratio(num(s.cost_prev), resolvedPrev * pricedShare(spend));
  const addJudge = () => LW.navigate("onlineEvaluations", {});
  const percent = (value) => pct(value, 0);
  // Worse: moved the wrong way by more than the half a percent Change reads as flat.
  const worse = (now, before, better) => known(now) && num(before) > 0 &&
    ((now - before) / before) * (better === "up" ? -1 : 1) > 0.005;
  signalProblem(
    worse(ratio(resolved, num(o.closed)), ratio(resolvedPrev, num(o.closed_prev)), "up") ||
    worse(ratio(num(k.passed), num(k.judged)), ratio(num(k.passed_prev), num(k.judged_prev)),
      "up") ||
    (resolved > 0 && worse(perSuccess, perSuccessPrev, "down")));
  return (
    <Panel>
      <Figures>
        <Figure label="Resolved conversations"
          value={num(o.closed) > 0 ? percent(ratio(resolved, num(o.closed))) : "Not scored yet"}>
          {num(o.closed) > 0 ? (
            <Change now={ratio(resolved, num(o.closed))}
              before={ratio(resolvedPrev, num(o.closed_prev))} better="up" format={percent} />
          ) : (
            <Hint onClick={addJudge}>Score how conversations end</Hint>
          )}
        </Figure>
        <Figure label="Conversations" value={count(conversations)}>
          <Change now={conversations} before={num(s.conversations_prev)} better="up"
            format={count} />
        </Figure>
        <Figure label="Automatic checks passed"
          value={num(k.judged) > 0 ? percent(ratio(num(k.passed), num(k.judged))) : "No checks yet"}>
          {num(k.judged) > 0 ? (
            <Change now={ratio(num(k.passed), num(k.judged))}
              before={ratio(num(k.passed_prev), num(k.judged_prev))} better="up"
              format={percent} />
          ) : (
            <Hint onClick={addJudge}>Add a check</Hint>
          )}
        </Figure>
        <Figure label="AI cost per resolved conversation" value={resolved > 0 ? usd(perSuccess) : "-"}>
          {resolved > 0 ? (
            <Change now={perSuccess} before={perSuccessPrev} better="down" format={usd} />
          ) : (
            <Hint>{spentHint(spend, num(s.cost))}</Hint>
          )}
        </Figure>
      </Figures>
    </Panel>
  );`,
});

// The problem's name and its figure; the sentence that explains it is the hover.
const PROBLEM = `function Problem({ title, detail, onOpen, children }) {
  return (
    <div title={detail} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div onClick={onOpen} style={{ fontSize: 15, fontWeight: 500, lineHeight: 1.35,
        color: C.red, cursor: onOpen ? "pointer" : "default" }}>{title}</div>
      <div style={{ fontSize: 12.5, color: C.subtle }}>{children}</div>
    </div>
  );
}
const strong = (text) => <span style={{ fontWeight: 500, color: C.text }}>{text}</span>;`;

/** The prototype tries, in order: a segment that slid, a growing failure, a judge, a step. */
const ATTENTION_RULES = `// Pass rates shrink toward the mean of all segments, so a small one cannot top the list.
function biggestDrop(rows) {
  const live = rows.map((row) => ({ ...row, pass: num(row.pass), n: num(row.n),
    basePass: num(row.base_pass), baseN: num(row.base_n) })).filter((row) => row.n > 0);
  const total = live.reduce((sum, row) => sum + row.n, 0);
  if (total === 0) return undefined;
  const mean = live.reduce((sum, row) => sum + row.pass, 0) / total;
  const spread = live.reduce((sum, row) => sum + row.n * (row.pass / row.n - mean) ** 2, 0) / total
    - (mean * (1 - mean) * live.length) / total;
  const prior = Math.min(2000, Math.max(5, (mean * (1 - mean)) / Math.max(1e-6, spread) - 1));
  const scored = live.filter((row) => row.baseN > 0).map((row) => {
    const baseRate = row.basePass / row.baseN;
    const shrunk = (row.pass + prior * mean) / (row.n + prior);
    const p = Math.min(0.99, Math.max(0.01, baseRate));
    const z = (baseRate - shrunk) / Math.sqrt(p * (1 - p) * (1 / row.n + 1 / row.baseN));
    return { ...row, rate: row.pass / row.n, baseRate, z };
  });
  return scored.filter((row) => row.baseRate - row.rate >= 0.005 && row.z >= 2)
    .toSorted((a, b) => b.z - a.z)[0];
}

function growingReason(rows) {
  const now = rows.reduce((sum, row) => sum + num(row.now), 0);
  const before = rows.reduce((sum, row) => sum + num(row.before), 0);
  if (now === 0 || before === 0) return undefined;
  const grown = rows.filter((row) => row.outcome !== "resolved").map((row) => ({ ...row,
    share: num(row.now) / now, baseShare: num(row.before) / before }));
  const top = grown.toSorted((a, b) => b.share - b.baseShare - (a.share - a.baseShare))[0];
  return top && top.share - top.baseShare >= 0.01 ? top : undefined;
}

// Cohen's kappa: agreement with the reviewers beyond what chance alone would give.
function kappa(row) {
  const n = num(row.audited);
  const judge = num(row.judge_pass) / n;
  const reviewer = num(row.reviewer_pass) / n;
  const chance = judge * reviewer + (1 - judge) * (1 - reviewer);
  return chance >= 1 ? 1 : (num(row.agree) / n - chance) / (1 - chance);
}`;

/** Needs attention: one problem, so the reader knows where to start this week. */
export const ATTENTION_CODE = widgetCode({
  summary: "The one problem to look at first: a segment that slid, a failure, a judge or a step.",
  subtitle:
    "Picks the one problem that got worse the most against the previous period: a customer " +
    "whose checks fail more, a growing reason for failure, a check that disagrees with your " +
    "reviewers, or a step that keeps failing.",
  source: "evaluations",
  compactCallToAction: true,
  parts: [NUMBERS, WORDS, TRACES_LINK],
  components: `${PROBLEM}

${ATTENTION_RULES}`,
  queries: ["segments", "reasons", "agreement", "step"],
  body: `  const drop = biggestDrop(segments.data);
  if (drop) {
    const many = drop.kind === "customer" ? "customers" : "topics";
    const filter = drop.kind === "customer" ? { customer: drop.segment } : {};
    return (
      <Panel>
        <Problem title={"Checks fail more for " + drop.segment} onOpen={() => openTraces(filter)}
          detail={"The biggest drop of " + segments.data.length + " " + many + "."}>
          {strong(pct(drop.baseRate, 0))} passed in the previous period, {strong(pct(drop.rate, 0))}
          {" "}now
        </Problem>
      </Panel>
    );
  }
  const reason = growingReason(reasons.data);
  if (reason) {
    return (
      <Panel>
        <Problem title={"More conversations fail because: " + words(reason.reason)}
          onOpen={() => openTraces()}
          detail="The fastest growing reason conversations failed, against the previous period.">
          {strong(pct(reason.baseShare, 0))} of conversations then, {strong(pct(reason.share, 0))}
          {" "}now
        </Problem>
      </Panel>
    );
  }
  const drifted = agreement.data.map((row) => ({ name: row.evaluator, kappa: kappa(row) }))
    .filter((row) => row.kappa < 0.75).toSorted((a, b) => a.kappa - b.kappa)[0];
  if (drifted) {
    return (
      <Panel>
        <Problem title={'Your "' + drifted.name + '" check disagrees with your reviewers'}
          onOpen={() => LW.navigate("annotations", {})}
          detail={"It matches your reviewers " + drifted.kappa.toFixed(2) +
            " of the way (aim for 0.75 or more)."}>
          Check its last disagreements before you trust its scores
        </Problem>
      </Panel>
    );
  }
  const failing = step.data[0];
  const calls = num(failing?.calls);
  const reaching = ratio(num(failing?.errors) - num(failing?.recovered), calls);
  const seen = ratio(num(failing?.errors) - num(failing?.recovered), num(failing?.errors));
  if (failing && reaching >= 0.01) {
    return (
      <Panel>
        <Problem title={'"' + failing.step + '" keeps failing'}
          onOpen={() => openTraces({ spanName: failing.step, status: "error" })}
          detail={"Fails " + pct(ratio(num(failing.errors), calls)) + " of " + count(calls) +
            " calls, and the user saw " + pct(seen) + " of those failures."}>
          The user saw {strong(pct(seen))} of the failures
        </Problem>
      </Panel>
    );
  }
  const empty = [segments, reasons, step].every((query) => query.data.length === 0);
  if (empty) return <Panel><CallToAction /></Panel>;
  return <Panel><Note>Nothing got worse against the previous period.</Note></Panel>;`,
});

/** Top request my agent cannot serve: the product gap users hit most, with their own words. */
export const TOP_ASK_CODE = widgetCode({
  summary: "The topic users ask for most that my agent cannot serve, how often, and an example.",
  subtitle:
    "Requests your agent could not serve, grouped by topic, so you can treat the top one as a " +
    "product idea.",
  source: "judges",
  parts: [NUMBERS, TABLE, TRACE_LINK, SEEN_OR_SETUP, OUTCOME_EMPTY],
  queries: ["gap"],
  body: `  const closed = gap.data.reduce((sum, row) => sum + num(row.closed), 0);
  if (closed === 0) {
    return <Panel><OutcomeEmpty quiet="No conversations were scored in this period." /></Panel>;
  }
  const top = gap.data[0];
  if (num(top.gaps) === 0) {
    return <Panel><Note>Your agent could do everything people asked in this period.</Note></Panel>;
  }
  return (
    <Panel>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ fontSize: 15, fontWeight: 500, color: C.orange }}>{top.topic}</div>
        <div style={{ fontSize: 12.5, color: C.subtle }}>
          {count(num(top.gaps))} conversations ({pct(ratio(num(top.gaps), closed), 0)}) asked for
          this and your agent could not do it.
        </div>
        {top.example && (
          <div style={{ borderLeft: "2px solid " + C.border, paddingLeft: 8, fontSize: 12 }}>
            "{top.example}"
          </div>
        )}
        {top.trace_id && (
          <span onClick={() => LW.navigate("trace", { traceId: top.trace_id })}
            style={{ fontSize: 12, color: C.teal, cursor: "pointer" }}>
            Open an example
          </span>
        )}
      </div>
    </Panel>
  );`,
});

/** Resolved per day: whether a change to the prompt or the model moved the outcome. */
export const RESOLVED_TREND_CODE = widgetCode({
  summary:
    "Conversations resolved per bucket and their share, with model and prompt changes marked.",
  subtitle:
    "Resolved conversations over time. Lines mark a new prompt version or model, so you can see " +
    "if a change moved the rate.",
  source: "judges",
  recharts: MARKED_CHART_IMPORTS,
  parts: [
    NUMBERS,
    DATES,
    CHART_STYLE,
    BUCKETS,
    GAP_BRIDGE,
    MARKED_CHART,
    SEEN_OR_SETUP,
    OUTCOME_EMPTY,
  ],
  queries: ["trend", "changes", "versions"],
  body: `  if (trend.data.length === 0) {
    return <Panel><OutcomeEmpty quiet="No conversations were scored in this period." /></Panel>;
  }
  const names = new Map(versions.data.map((row) => [row.id, row.name]));
  const counts = [{ key: "resolved", kind: "count" }, { key: "closed", kind: "count" }];
  const points = withBuckets(trend, counts).map((row) => ({
    x: bucketLabel(row.bucket), at: bucketStart(row.bucket),
    resolved: num(row.resolved),
    share: num(row.closed) > 0 ? num(row.resolved) / num(row.closed) : null,
  }));
  const resolved = trend.data.reduce((sum, row) => sum + num(row.resolved), 0);
  const closed = trend.data.reduce((sum, row) => sum + num(row.closed), 0);
  const series = [
    { key: "resolved", label: "Resolved conversations", colour: C.teal, bars: true },
    { key: "share", label: "Share resolved", colour: C.orange, right: true },
  ];
  const shares = points.map((point) => point.share).filter(known);
  signalProblem(shares.length > 1 && shares[shares.length - 1] < shares[0]);
  return (
    <Panel>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 22, fontWeight: 600 }}>{pct(resolved / closed, 0)}</span>
        <span style={{ fontSize: 11, color: C.subtle }}>
          of {count(closed)} finished conversations were resolved
        </span>
      </div>
      <MarkedChart points={points} series={series} format={count}
        rightFormat={(value) => pct(value, 0)} markers={changes.data.map((row) => markerOf(row, names))} />
    </Panel>
  );`,
});

/** Task success: a language whose calls fail more is hidden in the overall rate. */
export const TASK_SUCCESS_CODE = widgetCode({
  summary: "Share of calls that got their task done, per language; calls with no task left out.",
  subtitle:
    "Share of calls that got the job done, per language, as your app reports it or LangWatch's " +
    "outcome check scored it.",
  source: "judges",
  recharts: MARKED_CHART_IMPORTS,
  parts: [
    NUMBERS,
    DATES,
    CHART_STYLE,
    BARS,
    FIGURES,
    BUCKETS,
    GAP_BRIDGE,
    MARKED_CHART,
    PIVOT,
    SEEN_OR_SETUP,
    OUTCOME_EMPTY,
  ],
  queries: ["trend"],
  body: `  if (trend.data.length === 0) {
    return <Panel><OutcomeEmpty quiet="No calls were scored in this period." /></Panel>;
  }
  const byLanguage = new Map();
  for (const row of trend.data) {
    const total = byLanguage.get(row.language) || { language: row.language, done: 0, calls: 0 };
    total.done += num(row.done);
    total.calls += num(row.calls);
    byLanguage.set(row.language, total);
  }
  const languages = [...byLanguage.values()].toSorted((a, b) => b.calls - a.calls).slice(0, 6);
  const names = new Intl.DisplayNames(["en"], { type: "language" });
  const languageName = (code) => {
    try {
      return names.of(code) || code;
    } catch {
      return code;
    }
  };
  const shares = pivot(trend.data, "language", (row) => ratio(num(row.done), num(row.calls)));
  const points = labelled(withBuckets(trend, languages.map((row) => row.language), shares));
  const series = languages.map((row, index) => ({
    key: row.language,
    label: languageName(row.language),
    colour: colourFor(row.language, index),
  }));
  // Clearly behind: a language 10 points or more under the best one.
  const rates = languages.map((row) => ratio(row.done, row.calls)).filter(known);
  signalProblem(rates.length > 1 && Math.max(...rates) - Math.min(...rates) >= 0.1);
  return (
    <Panel>
      <Figures>
        {languages.slice(0, 3).map((row) => (
          <Figure key={row.language} label={languageName(row.language) + ": calls that got the job done"}
            value={pct(ratio(row.done, row.calls))}>
            <Hint>{count(row.calls)} calls</Hint>
          </Figure>
        ))}
      </Figures>
      <div style={{ height: 8 }} />
      <MarkedChart points={points} series={series} format={(value) => pct(value, 0)}
        domain={[0, 1]} legendKind="language" />
    </Panel>
  );`,
});

/** Accepted, edited or regenerated: a rising regenerated share means the output misses. */
export const ACCEPTANCE_CODE = widgetCode({
  summary:
    "Per bucket: the share of generated outputs users accepted, edited, regenerated or ignored.",
  subtitle: "What people did with each output, as your app reports it.",
  source: "requests",
  recharts: MARKED_CHART_IMPORTS,
  parts: [
    NUMBERS,
    DATES,
    CHART_STYLE,
    FIGURES,
    BUCKETS,
    GAP_BRIDGE,
    MARKED_CHART,
    PIVOT,
    TRACES_LINK,
    SEEN_OR_SETUP,
  ],
  queries: ["actions"],
  body: `  if (actions.data.length === 0) {
    return (
      <Panel>
        <SeenOrSetup quiet="No outputs were reported in this period." action="Show me how"
          onAction={() => openTraces()}>
          Your app does not tell LangWatch yet what people do with each output (kept, edited,
          asked again, dropped). Add it and this fills in.
        </SeenOrSetup>
      </Panel>
    );
  }
  const totals = new Map();
  for (const row of actions.data) {
    totals.set(row.bucket, (totals.get(row.bucket) || 0) + num(row.outputs));
  }
  const actionKeys = ["accepted", "edited", "regenerated", "dropped"];
  const shares = pivot(actions.data, "action", (row) => num(row.outputs) / totals.get(row.bucket));
  const points = labelled(withBuckets(actions, actionKeys, shares));
  const all = [...totals.values()].reduce((sum, value) => sum + value, 0);
  const share = (action) => ratio(actions.data.filter((row) => row.action === action)
    .reduce((sum, row) => sum + num(row.outputs), 0), all);
  const series = [
    { key: "accepted", label: "Kept as is", colour: C.green, bars: true, stack: "a" },
    { key: "edited", label: "Edited", colour: C.teal, bars: true, stack: "a" },
    { key: "regenerated", label: "Asked again", colour: C.orange, bars: true, stack: "a" },
    { key: "dropped", label: "Dropped", colour: C.strong, bars: true, stack: "a" },
  ];
  const kept = points.map((point) => point.accepted).filter(known);
  signalProblem(kept.length > 1 && kept[kept.length - 1] < kept[0]);
  return (
    <Panel>
      <Figures>
        <Figure label="Accepted as is" value={pct(share("accepted"), 0)} />
        <Figure label="Edited before use" value={pct(share("edited"), 0)} />
        <Figure label="Asked again" value={pct(share("regenerated"), 0)}>
          <Hint>of {count(all)} outputs</Hint>
        </Figure>
      </Figures>
      <div style={{ height: 8 }} />
      <MarkedChart points={points} series={series} format={(value) => pct(value, 0)}
        domain={[0, 1]} legendKind="action" />
    </Panel>
  );`,
});
