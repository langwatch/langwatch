/**
 * Stored TSX for the What users ask board, after the prototype's cards: requests the agent
 * cannot serve, topics that rise or appear, how each topic goes, and the conversations
 * where the first answer missed. Product ideas, never priced.
 */

import {
  BUCKETS,
  CHART_STYLE,
  DATES,
  GAP_BRIDGE,
  HEADLINE,
  NUMBERS,
  SERIES_CHART,
  SERIES_CHART_IMPORTS,
  STAT,
  TABLE,
  widgetCode,
} from "../../templates/model/widget-code-parts.ts";
import { SHARE_ROWS, SPARK, TOPIC_NAME } from "./answers-asks-parts.ts";

export const CANNOT_SERVE_CODE = widgetCode({
  summary: "Conversations per topic judged to ask for something the agent cannot do.",
  subtitle: "Requests your agent has no way to serve, which you can treat as product ideas.",
  source: "judges",
  parts: [NUMBERS, HEADLINE, TOPIC_NAME, SHARE_ROWS],
  queries: ["topics", "totals"],
  body: `  const closed = num(totals.data[0]?.closed);
  const cannot = num(totals.data[0]?.cannot);
  if (!closed) return <Panel><CallToAction /></Panel>;
  if (!cannot) {
    return <Panel><Note>Your agent could do everything people asked in this period.</Note></Panel>;
  }
  const widest = Math.max(...topics.data.map((row) => num(row.requests)), 1);
  const rows = topics.data.map((row) => ({
    label: topicName(row.topic),
    key: row.topic,
    value: num(row.requests) / widest,
    figure: count(num(row.requests)),
    note: row.reason ? "Most asked: " + row.reason : undefined,
  }));
  const label = "of " + count(closed) + " finished conversations (" + pct(ratio(cannot, closed), 0) +
    ") asked for something your agent can't do";
  return (
    <Panel>
      <Headline value={count(cannot)} label={label} />
      <ShareRows rows={rows} kind="topic" />
    </Panel>
  );`,
});

export const RISING_TOPICS_CODE = widgetCode({
  summary: "Topics whose share of traces grew against the period before, and topics that are new.",
  subtitle:
    "Topics that take a bigger share of requests than in the previous period. Check that your " +
    "agent can handle them.",
  parts: [NUMBERS, TOPIC_NAME, SPARK],
  queries: ["shares", "daily"],
  body: `  if (shares.data.length === 0) {
    return (
      <Panel>
        <Note>
          No topics yet. LangWatch groups requests into topics once it has a few hundred of them.
        </Note>
      </Panel>
    );
  }
  const total = (key) => shares.data.reduce((sum, row) => sum + num(row[key]), 0);
  const now = total("in_period");
  const before = total("in_previous");
  if (before === 0) {
    return (
      <Panel>
        <Note>
          Nothing to compare with yet: the previous period had no topics.
        </Note>
      </Panel>
    );
  }
  const buckets = {};
  for (const row of daily.data) {
    const bucket = (buckets[row.bucket] = buckets[row.bucket] || { all: 0 });
    bucket.all += num(row.traces);
    bucket[row.topic] = num(row.traces);
  }
  const order = Object.keys(buckets).toSorted();
  const rows = shares.data
    .map((row) => ({
      topic: row.topic,
      share: num(row.in_period) / Math.max(now, 1),
      was: num(row.in_previous) / before,
      fresh: num(row.in_previous) === 0 && num(row.in_period) > 0,
    }))
    .filter((row) => row.fresh || row.share - row.was > 0.003)
    .toSorted((a, b) => Number(b.fresh) - Number(a.fresh) || b.share - b.was - (a.share - a.was))
    .slice(0, 5);
  if (rows.length === 0) {
    return <Panel><Note>No topic grew against the previous period.</Note></Panel>;
  }
  return (
    <Panel>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {rows.map((row) => (
          <div key={row.topic}
            {...askable({ kind: "topic", label: topicName(row.topic), value: row.topic })}
            style={{ display: "flex", alignItems: "center", gap: 8, ...askCursor() }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 500 }}>
                {topicName(row.topic)}
                {row.fresh ? <span style={{ marginLeft: 6, padding: "0 4px", borderRadius: 4,
                  fontSize: 10, color: C.teal, background: C.muted }}>New</span> : null}
              </div>
              <div style={{ fontSize: 11, color: C.subtle }}>
                {pct(row.share, 1) + " of requests" +
                  (row.fresh ? ", none in the period before" : ", up from " + pct(row.was, 1))}
              </div>
            </div>
            <Spark colour={C.teal} values={order.map((key) =>
              buckets[key].all > 0 ? (buckets[key][row.topic] || 0) / buckets[key].all : null)} />
          </div>
        ))}
      </div>
    </Panel>
  );`,
});

export const TOPIC_QUALITY_CODE = widgetCode({
  summary: "Per topic: traces, the share that went well, and requests the agent could not serve.",
  subtitle:
    "Went well counts resolved conversations (or checks passed, until outcomes are scored), and " +
    "red marks a topic clearly below your others. Click a topic to ask Langy about it.",
  parts: [NUMBERS, TABLE, TOPIC_NAME],
  queries: ["topics"],
  body: `  if (topics.data.length === 0) {
    return (
      <Panel>
        <Note>
          No topics yet. LangWatch groups requests into topics once it has a few hundred of them.
        </Note>
      </Panel>
    );
  }
  // Judged outcomes read best; without an outcome judge, the checks' pass rate stands in.
  const byOutcome = topics.data.some((row) => num(row.closed) > 0);
  const went = (row) => {
    const [good, all] = byOutcome
      ? [num(row.resolved), num(row.closed)]
      : [num(row.checks_passed), num(row.checks_run)];
    return all > 0 ? good / all : null;
  };
  const known = topics.data.map(went).filter((value) => value !== null);
  const average = known.reduce((sum, value) => sum + value, 0) / Math.max(known.length, 1);
  const success = (row) => {
    const value = went(row);
    if (value === null) return <span style={{ color: C.faint }}>-</span>;
    return <b style={{ color: value < average - 0.03 ? C.red : C.text }}>{pct(value, 0)}</b>;
  };
  const columns = [
    { header: "Topic", cell: (row) => topicName(row.topic) },
    { header: "Conversations", align: "right", cell: (row) => count(num(row.requests)) },
    { header: "Went well", align: "right", cell: success },
    {
      header: "Could not do",
      align: "right",
      cell: (row) => <span style={{ color: C.subtle }}>{count(num(row.cannot))}</span>,
    },
  ];
  signalProblem(known.some((value) => value < average - 0.03));
  return (
    <Panel>
      <Table columns={columns} rows={topics.data} rowPadding={3}
        ask={(row) => ({ kind: "topic", label: topicName(row.topic), value: row.topic })} />
    </Panel>
  );`,
});

export const ASKED_AGAIN_CODE = widgetCode({
  summary: "Share of closed conversations judged misread the first time, and returning users.",
  subtitle: "Share of conversations where your agent misread what the person meant.",
  source: "judges",
  recharts: SERIES_CHART_IMPORTS,
  parts: [NUMBERS, DATES, CHART_STYLE, BUCKETS, GAP_BRIDGE, SERIES_CHART, STAT],
  queries: ["trend", "users"],
  body: `  if (trend.data.length === 0) return <Panel><CallToAction /></Panel>;
  const closed = trend.data.reduce((sum, row) => sum + num(row.closed), 0);
  const active = num(users.data[0]?.active);
  const returning = num(users.data[0]?.returning);
  const misread = trend.data.reduce((sum, row) => sum + num(row.misunderstood), 0);
  const points = withBuckets(trend, ["misunderstood", "closed"]).map((row) => ({
    x: bucketLabel(row.bucket), at: bucketStart(row.bucket),
    misread: ratio(row.misunderstood, row.closed),
  }));
  signalProblem(num(latest(points, "misread")) > num(earliest(points, "misread")));
  return (
    <Panel>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8,
        marginBottom: 8 }}>
        <Stat label={"Misunderstood the first time: " + count(misread) + " of " + count(closed) +
          " conversations"} value={pct(ratio(misread, closed), 1)} />
        {active > 0 ? (
          <Stat label={"Came back: " + count(returning) + " of " + count(active) + " people"}
            value={pct(returning / active, 0)} />
        ) : null}
      </div>
      <SeriesChart points={points} format={(value) => pct(value, 0)} domain={[0, "auto"]}
        series={[{ key: "misread", label: "Misunderstood the first time", colour: C.orange }]} />
    </Panel>
  );`,
});
