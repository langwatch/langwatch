/**
 * Stored TSX for the Answer quality board, after the prototype's cards: how conversations
 * ended and why, unanswered topics, judges against reviewers, the review queue, and for an
 * assistant that searches, whether the search or the answer failed.
 */

import {
  CHART_STYLE,
  DATES,
  HEADLINE,
  NUMBERS,
  SERIES_CHART,
  SERIES_CHART_IMPORTS,
  STAT,
  TABLE,
  TRACE_LINK,
  widgetCode,
} from "../../templates/model/widget-code-parts.ts";
import { SHARE_ROWS, SPARK, TOPIC_NAME } from "./answers-asks-parts.ts";

const SERIES_PARTS = [NUMBERS, DATES, CHART_STYLE, HEADLINE, SERIES_CHART];

const OUTCOMES = `const FAILURES = [
  ["misunderstood", "Misunderstood", C.orange],
  ["capability_gap", "Could not do it", C.pink],
  ["refusal", "Refused", C.red],
  ["handover", "Handed to a person", C.teal],
];`;

export const OUTCOMES_CODE = widgetCode({
  summary: "Share of closed conversations per bucket by how they failed, and the top reasons.",
  subtitle: "An outcome the app sends wins; otherwise the outcome judge decides",
  source: "judges",
  recharts: SERIES_CHART_IMPORTS,
  parts: [...SERIES_PARTS, OUTCOMES],
  queries: ["trend", "totals", "reasons"],
  body: `  if (trend.data.length === 0) return <Panel><CallToAction /></Panel>;
  const closed = trend.data.reduce((sum, row) => sum + num(row.closed), 0);
  const resolved = trend.data.reduce((sum, row) => sum + num(row.resolved), 0);
  const previous = num(totals.data[0]?.closed_previous);
  const points = trend.data.map((row) => {
    const point = { x: bucketLabel(row.bucket) };
    for (const [key] of FAILURES) {
      point[key] = num(row.closed) > 0 ? num(row[key]) / num(row.closed) : 0;
    }
    return point;
  });
  const series = FAILURES.map(([key, label, colour]) => ({ key, label, colour }));
  const label = "of " + count(closed) + " closed conversations resolved";
  return (
    <Panel>
      <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "1fr 16rem",
        gap: 20 }}>
        <div style={{ minHeight: 0, display: "flex", flexDirection: "column" }}>
          <Headline value={pct(resolved / closed, 0)} label={label} />
          <SeriesChart points={points} series={series} format={(value) => pct(value, 0)} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 11.5, color: C.subtle, marginBottom: 6 }}>Top reasons</div>
          {reasons.data.map((row) => {
            const share = num(row.in_period) / closed;
            const before = previous > 0 ? num(row.in_previous) / previous : null;
            const moved = before === null ? 0 : share - before;
            return (
              <div key={row.reason} style={{ padding: "2px 0" }}>
                <div style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis",
                  whiteSpace: "nowrap" }} title={row.reason}>{row.reason}</div>
                <div style={{ display: "flex", gap: 6, fontSize: 11,
                  fontVariantNumeric: "tabular-nums" }}>
                  <b>{pct(share, 0)}</b>
                  {Math.abs(moved) >= 0.005 ? (
                    <span style={{ color: moved > 0 ? C.red : C.green }}>
                      {(moved > 0 ? "up" : "down") + " from " + pct(before, 0)}
                    </span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Panel>
  );`,
});

export const UNANSWERED_CODE = widgetCode({
  summary: "Share of closed conversations refused per topic, with the overall share per bucket.",
  subtitle: "Add content or tools for the topics at the top",
  source: "judges",
  parts: [NUMBERS, STAT, TOPIC_NAME, SHARE_ROWS, SPARK],
  queries: ["topics", "trend"],
  body: `  if (trend.data.length === 0) return <Panel><CallToAction /></Panel>;
  const closed = trend.data.reduce((sum, row) => sum + num(row.closed), 0);
  const refused = trend.data.reduce((sum, row) => sum + num(row.refused), 0);
  const average = closed > 0 ? refused / closed : 0;
  const shareOf = (row) => (num(row.closed) > 0 ? num(row.refused) / num(row.closed) : 0);
  const widest = Math.max(...topics.data.map(shareOf), Number.MIN_VALUE);
  const rows = topics.data.map((row) => ({
    label: topicName(row.topic),
    value: shareOf(row) / widest,
    figure: pct(shareOf(row), 0),
    colour: shareOf(row) > average * 1.3 ? C.red : C.orange,
    title: count(num(row.refused)) + " of " + count(num(row.closed)) + " got no answer",
  }));
  const daily = trend.data.map((row) =>
    num(row.closed) > 0 ? num(row.refused) / num(row.closed) : null);
  return (
    <Panel>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 14rem", gap: 20 }}>
        {rows.length > 0
          ? <ShareRows rows={rows} />
          : <Note>No topics on these conversations</Note>}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Stat label="All conversations" value={pct(average, 1)} />
          <div style={{ fontSize: 11, color: C.subtle }}>
            {count(refused) + " of " + count(closed) + " closed conversations got no answer"}
          </div>
          <Spark values={daily} colour={C.orange} width={200} height={48} />
        </div>
      </div>
    </Panel>
  );`,
});

/** The agreement score a judge should hold with reviewers, as the catalogue states it. */
const KAPPA_TARGET = 0.8;

export const JUDGE_AGREEMENT_CODE = widgetCode({
  summary: "Agreement beyond chance between each judge and reviewer thumbs, week by week.",
  subtitle: "Reviewers in LangWatch against the judges, 0.8 or more is good",
  source: "feedback",
  recharts: SERIES_CHART_IMPORTS,
  parts: SERIES_PARTS,
  queries: ["weekly"],
  body: `  if (weekly.data.length === 0) return <Panel><CallToAction /></Panel>;
  const kappa = (value) => num(value).toFixed(2);
  const reviewed = {};
  for (const row of weekly.data) {
    reviewed[row.evaluator] = (reviewed[row.evaluator] || 0) + num(row.reviewed);
  }
  const judges = Object.keys(reviewed).toSorted((a, b) => reviewed[b] - reviewed[a]).slice(0, 4);
  const colours = [C.teal, C.orange, C.pink, "#9f7aea"];
  const weeks = {};
  for (const row of weekly.data) {
    const index = judges.indexOf(row.evaluator);
    if (index < 0) continue;
    const week = (weeks[row.week] = weeks[row.week] || { x: bucketLabel(row.week),
      target: ${KAPPA_TARGET} });
    week["j" + index] = num(row.kappa);
  }
  const points = Object.keys(weeks).toSorted().map((week) => weeks[week]);
  const series = [
    ...judges.map((name, index) => ({ key: "j" + index, label: name, colour: colours[index] })),
    { key: "target", label: "target", colour: C.red, dashed: true },
  ];
  const latest = points[points.length - 1];
  return (
    <Panel>
      <SeriesChart points={points} series={series} format={kappa} domain={["auto", 1]} />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 4, fontSize: 11 }}>
        {judges.map((name, index) => {
          const value = latest["j" + index];
          if (value === undefined) return null;
          const colour = value < ${KAPPA_TARGET} ? C.red : C.text;
          return (
            <span key={name} title={count(reviewed[name]) + " answers reviewed in the period"}>
              <span style={{ color: C.subtle }}>{name + " this week "}</span>
              <b style={{ color: colour }}>{kappa(value)}</b>
            </span>
          );
        })}
      </div>
    </Panel>
  );`,
});

export const REVIEW_QUEUE_CODE = widgetCode({
  summary: "Traces a check failed in the last 3 days with the check's reason, plus one at random.",
  subtitle: "Review them, and add the bad ones to a dataset",
  source: "evaluations",
  parts: [NUMBERS, TABLE, TRACE_LINK, HEADLINE],
  queries: ["flagged", "audit"],
  body: `  if (flagged.data.length + audit.data.length === 0) {
    return <Panel><CallToAction /></Panel>;
  }
  const total = num(flagged.data[0]?.flagged);
  const rows = [
    ...flagged.data,
    ...audit.data.map((row) => ({ ...row, reason: "Picked at random to check the judges" })),
  ];
  const reason = (row) => (
    <span title={row.reason} style={{ display: "block", maxWidth: 260, color: C.subtle,
      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
      {row.reason || "No reason given"}
    </span>
  );
  const columns = [
    { header: "Trace", cell: (row) => <TraceLink id={row.trace_id} /> },
    {
      header: "Check",
      cell: (row) => row.evaluator
        ? <span style={{ color: C.red }}>{row.evaluator}</span>
        : <span style={{ color: C.teal }}>random check</span>,
    },
    { header: "Why", cell: reason },
  ];
  return (
    <Panel>
      <Headline value={count(total)} label="traces a check failed in the last 3 days" />
      <Table columns={columns} rows={rows} rowPadding={3} />
    </Panel>
  );`,
});

export const FAILURE_SOURCE_CODE = widgetCode({
  summary: "Failed traces that searched, by cause: nothing found, a wrong answer, or an error.",
  subtitle: "Fix the larger cause first",
  source: "spans",
  recharts: SERIES_CHART_IMPORTS,
  parts: [...SERIES_PARTS, STAT],
  queries: ["trend"],
  body: `  if (trend.data.length === 0) return <Panel><CallToAction /></Panel>;
  const sum = (key) => trend.data.reduce((total, row) => total + num(row[key]), 0);
  const searched = sum("searched");
  const failures = sum("retrieval") + sum("generation") + sum("errors");
  const ofFailed = (value) => count(value) + " · " + pct(failures > 0 ? value / failures : 0, 0);
  const points = trend.data.map((row) => ({
    x: bucketLabel(row.bucket),
    retrieval: num(row.retrieval),
    generation: num(row.generation),
    errors: num(row.errors),
  }));
  const series = [
    { key: "retrieval", label: "search found nothing", colour: C.orange, bars: true },
    { key: "generation", label: "wrong answer from found passages", colour: C.pink, bars: true },
    { key: "errors", label: "tool or runtime error", colour: C.red, bars: true },
  ];
  return (
    <Panel>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8,
        marginBottom: 8 }}>
        <Stat label="Search found nothing" value={ofFailed(sum("retrieval"))} />
        <Stat label="Wrong answer, passages found" value={ofFailed(sum("generation"))} />
        <Stat label={"Errors, of " + count(searched) + " searches"}
          value={ofFailed(sum("errors"))} />
      </div>
      <SeriesChart points={points} series={series} format={count} />
    </Panel>
  );`,
});

export const EMPTY_RETRIEVAL_CODE = widgetCode({
  summary: "Share of questions per bucket whose search returned no documents.",
  subtitle: "Add content for the questions behind a rise",
  source: "spans",
  recharts: SERIES_CHART_IMPORTS,
  parts: SERIES_PARTS,
  queries: ["trend"],
  body: `  if (trend.data.length === 0) return <Panel><CallToAction /></Panel>;
  const sum = (key) => trend.data.reduce((total, row) => total + num(row[key]), 0);
  const questions = sum("questions");
  const empty = sum("empty_searches");
  const points = trend.data.map((row) => ({
    x: bucketLabel(row.bucket),
    rate: num(row.questions) > 0 ? num(row.empty_searches) / num(row.questions) : 0,
  }));
  const label = "of " + count(questions) + " questions found nothing; " +
    count(sum("empty_errored")) + " of those ended in an error";
  return (
    <Panel>
      <Headline value={pct(questions > 0 ? empty / questions : 0, 2)} label={label} />
      <SeriesChart points={points} format={(value) => pct(value, 1)} domain={[0, "auto"]}
        series={[{ key: "rate", label: "empty retrieval", colour: C.teal }]} />
    </Panel>
  );`,
});
