/**
 * Stored TSX for the org Flight deck: what needs attention, most urgent first, then every agent
 * the member can see with whether it runs as it normally does. The rules follow the prototype's
 * Flight deck; "normal" is the median of the same window over the four weeks before.
 */

import {
  BARS,
  CHART_STYLE,
  DATES,
  GAP_BRIDGE,
  NUMBERS,
  SERIES_CHART,
  SERIES_CHART_IMPORTS,
  widgetCode,
} from "../../templates/model/widget-code-parts.ts";

const DECK_QUERIES = ["agents", "lastSeen", "evaluations", "gaps"] as const;

/** Projects the fan-out could not read, and the line that says so. */
const PROJECT_GAPS = `const DENIED = ["permission_denied", "forbidden", "FORBIDDEN"];
function projectGaps(queries) {
  const failed = new Map();
  for (const query of queries) {
    for (const row of query.data) {
      if (row.project_error) failed.set(row.project_id, row);
    }
  }
  const rows = [...failed.values()];
  return {
    ids: new Set(rows.map((row) => row.project_id)),
    denied: rows.filter((row) => DENIED.includes(row.project_error_code)),
    broken: rows.filter((row) => !DENIED.includes(row.project_error_code)),
  };
}
const names = (rows) => rows.map((row) => row.project_name).join(", ");
function GapsNote({ gaps }) {
  if (gaps.denied.length === 0 && gaps.broken.length === 0) return null;
  const many = (rows) => (rows.length === 1 ? "1 project" : rows.length + " projects");
  return (
    <div style={{ marginTop: 8, fontSize: 11.5, color: C.subtle }}>
      {gaps.broken.length > 0 && (
        <div style={{ color: C.red }}>
          {many(gaps.broken)} could not load: {names(gaps.broken)}. Refresh to try again.
        </div>
      )}
      {gaps.denied.length > 0 && (
        <div>
          Left out: {names(gaps.denied)}. You cannot read {gaps.denied.length === 1 ? "its" :
          "their"} analytics.
        </div>
      )}
    </div>
  );
}`;

/** An agent is its project and the name its traces send; none, and the project stands in. */
const AGENT_KEY = `const keyOf = (row) => row.project_id + "|" + (row.agent || "");
const labelOf = (row) => (row.agent ? row.agent + " · " + row.project_name : row.project_name);`;

/** The deck itself: one row per agent per project, judged against its normal; reads `NUMBERS`. */
const DECK_MODEL = `const RANK = { danger: 0, warn: 1, ok: 2, neutral: 3 };
const LIGHT = { danger: C.red, warn: C.orange, ok: C.green, neutral: C.faint };
const worst = (lights) => lights.reduce((a, b) => (RANK[b] < RANK[a] ? b : a), "ok");
const HOUR = 3600 * 1000;
const at = (value) => new Date(String(value).replace(" ", "T") + "Z").getTime();

function median(values) {
  const v = values.filter(known).map(num).toSorted((a, b) => a - b);
  if (v.length === 0) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}
// The normal of a measure: its median over the same window one to four weeks back.
const normalOf = (weeks, read) => median([1, 2, 3, 4].map((wk) => (weeks[wk] ? read(weeks[wk]) : null)));

const NONE = { signal: { light: "neutral" } };
function judgeTraffic(now, normal) {
  if (!(normal > 0)) return { signal: { now: count(now), light: "neutral" } };
  const r = now / normal;
  const light = r < 0.5 || r > 2 ? "warn" : "ok";
  const signal = { now: count(now), normal: count(Math.round(normal)), light };
  return light === "ok" ? { signal }
    : { signal, reason: "Traffic " + (r < 1 ? "down" : "up") + " to " + Math.round(r * 100) + "% of normal" };
}
function judgeErrors(now, normal) {
  const n = known(normal) ? normal : now;
  const light = now >= 0.05 || now >= Math.max(2 * n, n + 0.02) ? "danger"
    : now >= Math.max(1.5 * n, n + 0.01) ? "warn" : "ok";
  const signal = { now: pct(now), normal: known(normal) ? pct(normal) : undefined, light };
  return light === "ok" ? { signal }
    : { signal, reason: "Error rate " + pct(now) + (known(normal) ? ", normally " + pct(n) : "") };
}
function judgeLatency(now, normal) {
  if (!(normal > 0)) return { signal: { now: ms(now), light: "neutral" } };
  const r = now / normal;
  const light = r >= 2 ? "danger" : r >= 1.5 ? "warn" : "ok";
  const signal = { now: ms(now), normal: ms(normal), light };
  return light === "ok" ? { signal }
    : { signal, reason: "p95 latency " + ms(now) + ", " + r.toFixed(1) + "× normal" };
}
function judgePass(now, normal) {
  const n = known(normal) ? normal : now;
  const drop = n - now;
  const light = drop >= 0.1 ? "danger" : drop >= 0.05 ? "warn" : "ok";
  const signal = { now: pct(now, 0), normal: known(normal) ? pct(normal, 0) : undefined, light };
  return light === "ok" ? { signal }
    : { signal, reason: "Eval pass rate " + pct(now, 0)
      + (known(normal) ? ", normally " + pct(n, 0) : "") };
}

function ago(time, end) {
  if (!known(time)) return "Never";
  const hours = (end - time) / HOUR;
  if (hours < 1) return Math.max(1, Math.round(hours * 60)) + " min ago";
  if (hours < 24) return Math.round(hours) + " h ago";
  if (hours < 48) return "Yesterday";
  return new Date(time).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function byKey(rows) {
  const map = new Map();
  for (const row of rows) {
    if (row.project_error || row.project_empty) continue;
    const key = keyOf(row);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
}
const weeksOf = (rows) => Object.fromEntries((rows || []).map((row) => [num(row.wk), row]));
const passRate = (rows) => {
  const judged = rows.reduce((sum, row) => sum + num(row.judged), 0);
  return judged > 0 ? rows.reduce((sum, row) => sum + num(row.passed), 0) / judged : null;
};

// One row per agent a project's traces name; a project with no named agent is its own row.
function deckRows({ agents, lastSeen, evaluations, gaps, end }) {
  const traffic = byKey(agents.data);
  const seen = byKey(lastSeen.data);
  const evals = byKey(evaluations.data);
  const projects = gaps.data.filter((row) => !row.project_error);
  const keys = new Set([...traffic.keys(), ...seen.keys()]);
  for (const project of projects) {
    if (![...keys].some((key) => key.startsWith(project.project_id + "|"))) {
      keys.add(project.project_id + "|");
    }
  }
  const projectOf = new Map(projects.map((row) => [row.project_id, row]));
  const named = new Set([...keys].filter((key) => !key.endsWith("|")).map((key) => key.split("|")[0]));
  return [...keys].flatMap((key) => {
    const [projectId, agent] = key.split("|");
    const project = projectOf.get(projectId);
    if (!project) return [];
    const weeks = weeksOf(traffic.get(key));
    const now = weeks[0] || { traces: 0, errors: 0 };
    const lastTrace = (seen.get(key) || [])[0]?.last_trace;
    const last = lastTrace ? at(lastTrace) : null;
    const sentBefore = [1, 2, 3, 4].some((wk) => num(weeks[wk]?.traces) > 0);
    const traces = num(now.traces) || 0;
    const t = judgeTraffic(traces, normalOf(weeks, (w) => (num(w.traces) > 0 ? num(w.traces) : null)));
    const rate = (w) => (num(w.traces) > 0 ? num(w.errors) / num(w.traces) : null);
    const e = traces > 0 ? judgeErrors(rate(now), normalOf(weeks, rate)) : NONE;
    const p95 = (w) => (num(w.traces) > 0 ? num(w.p95_ms) : null);
    const silent = last !== null && end - last > 24 * HOUR && (sentBefore || traces > 0);
    const l = traces > 0 ? judgeLatency(p95(now), normalOf(weeks, p95)) : NONE;
    const evalWeeks = {};
    for (const row of evals.get(key) || []) {
      const wk = num(row.wk);
      evalWeeks[wk] = [...(evalWeeks[wk] || []), row];
    }
    const passNow = passRate(evalWeeks[0] || []);
    const passNormal = median([1, 2, 3, 4].map((wk) => passRate(evalWeeks[wk] || [])));
    const p = known(passNow) ? judgePass(passNow, passNormal) : NONE;
    const cost = num(now.cost);
    const costNormal = normalOf(weeks, (w) => (num(w.cost) > 0 ? num(w.cost) : null));
    let light;
    let reason;
    if (last === null) {
      light = "warn";
      reason = "No traces received yet";
    } else if (silent) {
      light = "danger";
      reason = "Silent since " + new Date(last).toLocaleString("en-GB",
        { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    } else {
      const measures = [t, e, l, p];
      light = worst(measures.map((m) => m.signal.light).filter((x) => x !== "neutral"));
      reason = measures.find((m) => m.signal.light === light && m.reason)?.reason
        || "Running as it normally does";
    }
    return [{
      key,
      name: agent || project.project_name,
      // The rest of a project whose other traces do name their agent.
      unnamed: !agent && named.has(projectId),
      project: project.project_name,
      slug: project.project_slug,
      last,
      light,
      reason,
      silent,
      traffic: t.signal,
      errorRate: e.signal,
      p95: l.signal,
      evalPass: p.signal,
      cost,
      costNormal,
      unpriced: num(now.unpriced) > 0,
      spend: {
        now: known(cost) && traces > 0 ? usd(cost) + (num(now.unpriced) > 0 ? "+" : "") : undefined,
        normal: costNormal > 0 ? usd(costNormal) : undefined,
        light: costNormal > 0 && cost >= costNormal * 1.5 && cost - costNormal >= 5 ? "warn" : "ok",
        title: num(now.unpriced) > 0 ? count(now.unpriced) + " traces used a model with no price, "
          + "so the cost is at least this" : undefined,
      },
    }];
  });
}

const SEVERITY = { critical: 0, warn: 1, info: 2 };
const SEVERITY_LIGHT = { critical: "danger", warn: "warn", info: "neutral" };
const TRUST_FIELDS = [["no_cost", "a cost"], ["no_model", "a model"], ["no_user", "a user id"],
  ["no_thread", "a thread id"]];

// One ranked list: unhealthy and silent agents, failing checks, cost jumps and data gaps.
function attentionOf({ rows, evaluations, gaps, end }) {
  const items = [];
  for (const row of rows) {
    const base = { project: row.project, slug: row.slug, when: row.last, detail: row.reason };
    if (row.light === "danger" || row.light === "warn") {
      const severity = row.light === "danger" ? "critical" : "warn";
      const quiet = row.silent || row.last === null;
      items.push({ ...base, id: "row-" + row.key, severity, kind: quiet ? "Silent" : "Health",
        title: row.name + (row.last === null ? " has sent no traces yet"
          : quiet ? " has gone silent" : " is not running as it normally does") });
    }
    if (!row.silent && row.cost > 0 && row.costNormal > 0 && row.cost >= row.costNormal * 1.5
      && row.cost - row.costNormal >= 5) {
      items.push({ ...base, id: "cost-" + row.key, severity: "warn", kind: "Cost jump",
        title: row.name + " cost " + (row.cost / row.costNormal).toFixed(1) + "× its normal",
        detail: usd(row.cost) + (row.unpriced ? "+" : "") + " this period against a normal "
          + usd(row.costNormal) + "." });
    }
  }
  const checks = new Map();
  for (const row of evaluations.data) {
    if (row.project_error || row.project_empty) continue;
    const key = row.project_id + "|" + row.evaluator;
    if (!checks.has(key)) checks.set(key, { row, weeks: {} });
    const weeks = checks.get(key).weeks;
    weeks[num(row.wk)] = [...(weeks[num(row.wk)] || []), row];
  }
  for (const [key, check] of checks) {
    const now = passRate(check.weeks[0] || []);
    if (!known(now)) continue;
    const normal = median([1, 2, 3, 4].map((wk) => passRate(check.weeks[wk] || [])));
    const judged = judgePass(now, normal);
    if (judged.signal.light === "ok") continue;
    items.push({ id: "check-" + key, kind: "Failing check",
      severity: judged.signal.light === "danger" ? "critical" : "warn",
      title: check.row.evaluator + " is failing", detail: judged.reason,
      project: check.row.project_name, slug: check.row.project_slug,
      when: Math.max(...(check.weeks[0] || []).map((row) => at(row.last_run))) });
  }
  for (const project of gaps.data) {
    if (project.project_error || !(num(project.traces) > 0)) continue;
    for (const [field, what] of TRUST_FIELDS) {
      const missing = num(project[field]) / num(project.traces);
      if (missing <= 0.5) continue;
      items.push({ id: "trust-" + project.project_id + field, kind: "Trust check", severity: "info",
        title: pct(missing, 0) + " of " + project.project_name + " traces carry no "
          + what.replace(/^an? /, ""),
        detail: "Widgets that need " + what + " cannot answer for this project.",
        project: project.project_name, slug: project.project_slug, when: null });
    }
  }
  return items.toSorted((a, b) => SEVERITY[a.severity] - SEVERITY[b.severity]
    || (b.when ?? 0) - (a.when ?? 0));
}

function Dot({ light }) {
  return <span style={{ display: "inline-block", flexShrink: 0, width: 8, height: 8,
    borderRadius: 4, background: LIGHT[light] }} />;
}
function openProject(slug) {
  const { start, end } = LW.dashboardContext.timeWindow;
  LW.navigate("traces", { project: slug, startDate: start, endDate: end });
}`;

/** Needs attention: one ranked list across every project, the top eight before a fold. */
export const ORG_ATTENTION_CODE = widgetCode({
  summary: "What needs attention across every project, most urgent first.",
  subtitle:
    "The top problems across every agent in every project you can see, most urgent first: " +
    "agents that went silent or left their normal, failing checks, cost jumps and data gaps. " +
    "Normal is the same window over the four periods before. Fired alerts, budgets and owners " +
    "are not available here yet",
  react: ["useState"],
  parts: [NUMBERS, PROJECT_GAPS, AGENT_KEY, DECK_MODEL],
  queries: [...DECK_QUERIES],
  components: `const PREVIEW = 5;
function Attention({ items, end }) {
  const [open, setOpen] = useState(false);
  if (items.length === 0) {
    return <Note>Nothing needs you right now.</Note>;
  }
  const shown = open ? items : items.slice(0, PREVIEW);
  const rest = items.length - shown.length;
  return (
    <div style={{ border: "1px solid " + C.border, borderRadius: 8 }}>
      {shown.map((item, index) => (
        <div key={item.id} onClick={() => openProject(item.slug)} style={{ display: "flex",
          gap: 10, alignItems: "flex-start", padding: "7px 12px", cursor: "pointer",
          borderTop: index === 0 ? "none" : "1px solid " + C.border }}>
          <div style={{ paddingTop: 6 }}><Dot light={SEVERITY_LIGHT[item.severity]} /></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontSize: 10.5, fontWeight: 500, color: C.subtle, background: C.muted,
                borderRadius: 4, padding: "0 6px" }}>{item.kind}</span>
              <span style={{ fontSize: 13, fontWeight: 500 }}>{item.title}</span>
            </div>
            <div style={{ fontSize: 12, color: C.subtle }}>{item.detail}</div>
            <div style={{ fontSize: 11, color: C.faint }}>
              {item.project}{item.when ? " · " + ago(item.when, end) : ""}
            </div>
          </div>
          <span style={{ color: C.faint, paddingTop: 2 }}>›</span>
        </div>
      ))}
      {(rest > 0 || open) && (
        <div onClick={() => setOpen(!open)} style={{ borderTop: "1px solid " + C.border,
          padding: "8px 12px", fontSize: 12, fontWeight: 500, color: C.teal, cursor: "pointer" }}>
          {open ? "Show less" : "Show " + rest + " more"}
        </div>
      )}
    </div>
  );
}`,
  body: `  const end = LW.dashboardContext.timeWindow.end;
  const queries = { agents, lastSeen, evaluations, gaps };
  const rows = deckRows({ ...queries, end });
  const items = attentionOf({ rows, evaluations, gaps, end });
  return (
    <Panel>
      <Attention items={items} end={end} />
      <GapsNote gaps={projectGaps(Object.values(queries))} />
    </Panel>
  );`,
});

/** Everything connected: the agents and projects group, one row per agent, worst first. */
export const ORG_AGENTS_CODE = widgetCode({
  summary: "Every agent across every project, against its normal, worst first.",
  subtitle:
    "One row per agent across every project you can see, worst first. An agent is named by " +
    "the gen_ai.agent.name (or service.name) its traces send; traces that name none count " +
    "under their project. Each measure against the same window over the four periods before; " +
    "a row that has gone silent is red. Owners are not available here yet",
  parts: [NUMBERS, PROJECT_GAPS, AGENT_KEY, DECK_MODEL],
  queries: [...DECK_QUERIES],
  components: `const TH = { textAlign: "left", padding: "6px 8px", fontSize: 10.5, fontWeight: 600,
  letterSpacing: "0.06em", textTransform: "uppercase", color: C.faint, whiteSpace: "nowrap" };
const TD = { padding: "7px 8px", verticalAlign: "top" };
function Signal({ signal }) {
  if (!signal.now) return <td style={{ ...TD, color: C.faint }}>–</td>;
  const color = signal.light === "danger" ? C.red : signal.light === "warn" ? C.orange : C.text;
  return (
    <td title={signal.title} style={{ ...TD, whiteSpace: "nowrap" }}>
      <div style={{ color, fontWeight: 500 }}>{signal.now}</div>
      {signal.normal && <div style={{ fontSize: 10.5, color: C.faint }}>normal {signal.normal}</div>}
    </td>
  );
}
function Summary({ rows }) {
  const tally = (light) => rows.filter((row) => row.light === light).length;
  const words = { danger: "need a look", warn: "drifting", ok: "normal" };
  return (
    <div style={{ display: "flex", gap: 16, fontSize: 12, color: C.subtle, marginBottom: 6 }}>
      {["danger", "warn", "ok"].map((light) => (
        <span key={light} style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <Dot light={light} />
          <span style={{ fontWeight: 600, color: C.text }}>{tally(light)}</span> {words[light]}
        </span>
      ))}
    </div>
  );
}`,
  body: `  const end = LW.dashboardContext.timeWindow.end;
  const queries = { agents, lastSeen, evaluations, gaps };
  const rows = deckRows({ ...queries, end })
    .toSorted((a, b) => RANK[a.light] - RANK[b.light] || a.name.localeCompare(b.name));
  const gapsOf = projectGaps(Object.values(queries));
  if (rows.length === 0) {
    return <Panel><Note>No project you can read has sent traces yet.</Note><GapsNote gaps={gapsOf} /></Panel>;
  }
  return (
    <Panel>
      <Summary rows={rows} />
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", minWidth: 900, borderCollapse: "collapse", fontSize: 12.5,
          fontVariantNumeric: "tabular-nums" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid " + C.border }}>
              <th style={{ ...TH, width: 14 }} />
              {["Agent", "Project", "Owner", "Last trace", "Traffic", "Error rate",
                "p95 latency", "Eval pass rate", "Cost", "Why"].map((label) => (
                <th key={label} style={TH}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} onClick={() => openProject(row.slug)}
                style={{ borderTop: "1px solid " + C.border, cursor: "pointer" }}>
                <td style={{ ...TD, paddingTop: 12 }}><Dot light={row.light} /></td>
                <td style={{ ...TD, fontWeight: 500 }}>
                  {row.name}
                  {row.unnamed && <div style={{ fontSize: 10.5, fontWeight: 400, color: C.faint }}>
                    Traces that name no agent</div>}
                </td>
                <td style={{ ...TD, color: C.subtle }}>{row.project}</td>
                <td style={{ ...TD, color: C.faint }} title="Owners are not available here yet">–</td>
                <td style={{ ...TD, color: row.last === null ? C.faint : C.subtle,
                  whiteSpace: "nowrap" }}>{ago(row.last, end)}</td>
                <Signal signal={row.traffic} />
                <Signal signal={row.errorRate} />
                <Signal signal={row.p95} />
                <Signal signal={row.evalPass} />
                <Signal signal={row.spend} />
                <td style={{ ...TD, maxWidth: 240, color: row.light === "danger" ? C.red
                  : row.light === "warn" ? C.orange : C.subtle }}>{row.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <GapsNote gaps={gapsOf} />
    </Panel>
  );`,
});

/** The top agents of a bucketed query as chart series; reads `DATES`, `BARS` and `AGENT_KEY`. */
const AGENT_SERIES = `const TOP_AGENTS = 6;
// weight ranks the agents; value reads one bucket's rows of one agent.
function agentSeries({ rows, weight, value }) {
  const live = rows.filter((row) => !row.project_error && !row.project_empty);
  const groups = new Map();
  for (const row of live) groups.set(keyOf(row), [...(groups.get(keyOf(row)) || []), row]);
  const ranked = [...groups.entries()]
    .map(([key, list]) => ({ key, list, label: labelOf(list[0]),
      weight: list.reduce((sum, row) => sum + (num(weight(row)) || 0), 0) }))
    .filter((group) => group.weight > 0)
    .toSorted((a, b) => b.weight - a.weight);
  const shown = ranked.slice(0, TOP_AGENTS);
  const buckets = [...new Set(live.map((row) => String(row.bucket)))].toSorted();
  const points = buckets.map((bucket) => {
    const point = { x: bucketLabel(bucket) };
    shown.forEach((group, index) => {
      const inBucket = group.list.filter((row) => String(row.bucket) === bucket);
      point["a" + index] = inBucket.length > 0 ? value(inBucket) : null;
    });
    return point;
  });
  const series = shown.map((group, index) => ({ key: "a" + index, label: group.label,
    colour: RAMP[index % RAMP.length] }));
  return { points, series, ranked, hidden: ranked.length - shown.length };
}
function Hidden({ count }) {
  if (count <= 0) return null;
  return <div style={{ fontSize: 11, color: C.faint }}>{count} more agents not drawn</div>;
}`;

const sumOf = (rows: string, field: string) =>
  `${rows}.reduce((sum, row) => sum + (num(row.${field}) || 0), 0)`;

/** Quality: each agent's eval pass rate over the period, the busiest agents drawn. */
export const ORG_QUALITY_CODE = widgetCode({
  summary: "Eval pass rate per agent over time, across every project.",
  subtitle:
    "The share of evaluator checks that passed, per agent and bucket, for the six agents " +
    "with the most checks. Guardrails are left out. An agent is named by the gen_ai.agent.name " +
    "its traces send; traces that name none count under their project",
  recharts: SERIES_CHART_IMPORTS,
  parts: [NUMBERS, DATES, CHART_STYLE, GAP_BRIDGE, SERIES_CHART, BARS, PROJECT_GAPS, AGENT_KEY,
    AGENT_SERIES],
  queries: ["trend"],
  body: `  const chart = agentSeries({ rows: trend.data, weight: (row) => row.judged,
    value: (rows) => ratio(${sumOf("rows", "passed")}, ${sumOf("rows", "judged")}) });
  const gaps = projectGaps([trend]);
  if (chart.series.length === 0) {
    return <Panel><Note>No evaluator checked any agent in this period.</Note>
      <GapsNote gaps={gaps} /></Panel>;
  }
  return (
    <Panel>
      <SeriesChart points={chart.points} series={chart.series} format={(v) => pct(v, 0)}
        domain={[0, 1]} />
      <Hidden count={chart.hidden} />
      <GapsNote gaps={gaps} />
    </Panel>
  );`,
});

/** Behaviour: error rate and p95 per agent against its normal, and the tools it called. */
export const ORG_BEHAVIOUR_CODE = widgetCode({
  summary: "Error rate, p95 latency and tools used per agent, across every project.",
  subtitle:
    "Each agent's error rate and p95 latency against the same window over the four periods " +
    "before, and the tools its traces called (tool spans, by gen_ai.tool.name or span name), " +
    "busiest first, with how many calls failed",
  parts: [NUMBERS, PROJECT_GAPS, AGENT_KEY, DECK_MODEL],
  queries: [...DECK_QUERIES, "tools"],
  components: `const TH = { textAlign: "left", padding: "6px 8px", fontSize: 10.5, fontWeight: 600,
  letterSpacing: "0.06em", textTransform: "uppercase", color: C.faint, whiteSpace: "nowrap" };
const TD = { padding: "7px 8px", verticalAlign: "top" };
function Measure({ signal }) {
  if (!signal.now) return <td style={{ ...TD, color: C.faint }}>–</td>;
  const color = signal.light === "danger" ? C.red : signal.light === "warn" ? C.orange : C.text;
  return (
    <td style={{ ...TD, whiteSpace: "nowrap" }}>
      <div style={{ color, fontWeight: 500 }}>{signal.now}</div>
      {signal.normal && <div style={{ fontSize: 10.5, color: C.faint }}>normal {signal.normal}</div>}
    </td>
  );
}
function Tools({ list }) {
  if (list.length === 0) return <span style={{ color: C.faint }}>No tool calls</span>;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
      {list.slice(0, 6).map((tool) => (
        <span key={tool.tool} title={num(tool.failed) > 0 ? count(tool.failed) + " failed" : undefined}
          style={{ fontSize: 11, background: C.muted, borderRadius: 4, padding: "1px 6px",
            color: num(tool.failed) > 0 ? C.red : C.subtle }}>
          {tool.tool} <span style={{ color: C.faint }}>{count(tool.calls)}</span>
        </span>
      ))}
      {list.length > 6 && <span style={{ fontSize: 11, color: C.faint }}>+{list.length - 6}</span>}
    </div>
  );
}`,
  body: `  const end = LW.dashboardContext.timeWindow.end;
  const queries = { agents, lastSeen, evaluations, gaps };
  const toolsOf = new Map();
  for (const row of tools.data) {
    if (row.project_error || row.project_empty) continue;
    toolsOf.set(keyOf(row), [...(toolsOf.get(keyOf(row)) || []), row]);
  }
  const rows = deckRows({ ...queries, end }).filter((row) => row.last !== null)
    .toSorted((a, b) => RANK[a.light] - RANK[b.light] || a.name.localeCompare(b.name));
  const gapsOf = projectGaps([...Object.values(queries), tools]);
  if (rows.length === 0) {
    return <Panel><Note>No agent you can read sent traces in this period.</Note>
      <GapsNote gaps={gapsOf} /></Panel>;
  }
  return (
    <Panel>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", minWidth: 640, borderCollapse: "collapse", fontSize: 12.5,
          fontVariantNumeric: "tabular-nums" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid " + C.border }}>
              {["Agent", "Project", "Error rate", "p95 latency", "Tools used"].map((label) => (
                <th key={label} style={TH}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} style={{ borderTop: "1px solid " + C.border }}>
                <td style={{ ...TD, fontWeight: 500 }}>{row.name}</td>
                <td style={{ ...TD, color: C.subtle }}>{row.project}</td>
                <Measure signal={row.errorRate} />
                <Measure signal={row.p95} />
                <td style={TD}><Tools list={toolsOf.get(row.key) || []} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <GapsNote gaps={gapsOf} />
    </Panel>
  );`,
});

/** Value: spend per agent over time, and what each resolved outcome costs where it is known. */
export const ORG_VALUE_CODE = widgetCode({
  summary: "Spend per agent over time, and cost per resolved outcome, across every project.",
  subtitle:
    "Trace spend per agent and bucket for the six agents that spent most, then each agent's " +
    "spend and cost per resolved outcome: the outcome judge's \"resolved\" label or a trace's " +
    "metadata.outcome. Spend with traces on a model with no price is a lower bound, marked +",
  recharts: SERIES_CHART_IMPORTS,
  parts: [NUMBERS, DATES, CHART_STYLE, GAP_BRIDGE, SERIES_CHART, BARS, PROJECT_GAPS, AGENT_KEY,
    AGENT_SERIES],
  queries: ["spend", "resolved"],
  components: `const TH = { textAlign: "left", padding: "4px 8px", fontSize: 10.5, fontWeight: 600,
  letterSpacing: "0.06em", textTransform: "uppercase", color: C.faint, whiteSpace: "nowrap" };
const TD = { padding: "5px 8px" };`,
  body: `  const chart = agentSeries({ rows: spend.data, weight: (row) => row.cost,
    value: (rows) => ${sumOf("rows", "cost")} });
  const resolvedOf = new Map(resolved.data.filter((row) => !row.project_error && !row.project_empty)
    .map((row) => [keyOf(row), num(row.resolved)]));
  const gaps = projectGaps([spend, resolved]);
  if (chart.series.length === 0) {
    return <Panel><Note>No priced traces in this period.</Note><GapsNote gaps={gaps} /></Panel>;
  }
  return (
    <Panel>
      <div style={{ height: 230, display: "flex", flexDirection: "column" }}>
        <SeriesChart points={chart.points} series={chart.series} format={usd} />
      </div>
      <Hidden count={chart.hidden} />
      <table style={{ width: "100%", marginTop: 8, borderCollapse: "collapse", fontSize: 12,
        fontVariantNumeric: "tabular-nums" }}>
        <thead>
          <tr>{["Agent", "Spend", "Resolved", "Cost per resolved"].map((label) => (
            <th key={label} style={TH}>{label}</th>
          ))}</tr>
        </thead>
        <tbody>
          {chart.ranked.map((group) => {
            const cost = group.weight;
            const unpriced = ${sumOf("group.list", "unpriced")};
            const done = resolvedOf.get(group.key) || 0;
            return (
              <tr key={group.key} style={{ borderTop: "1px solid " + C.border }}>
                <td style={{ ...TD, fontWeight: 500 }}>{group.label}</td>
                <td style={TD} title={unpriced > 0 ? count(unpriced)
                  + " traces used a model with no price, so spend is at least this" : undefined}>
                  {usd(cost) + (unpriced > 0 ? "+" : "")}</td>
                <td style={TD}>{done > 0 ? count(done) : <span style={{ color: C.faint }}>
                  Not measured</span>}</td>
                <td style={TD}>{done > 0 ? usd(cost / done) + (unpriced > 0 ? "+" : "")
                  : <span style={{ color: C.faint }}>–</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <GapsNote gaps={gaps} />
    </Panel>
  );`,
});
