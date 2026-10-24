/**
 * The dashboards matrix worlds (issue 8573 rows D1, D2, A1, D3, X1, D5, plus B1): seeded traffic,
 * boards and widgets, and the code-check facts read back from the public API. A port of
 * `apps/ui/e2e/langy/{dashboards-world,traffic-pattern,board-state}.ts` to one shared project.
 */
import { createHash } from "node:crypto";

import { expectOk, type LangWatchHttp } from "./http.ts";
import type { MatrixWorld } from "./world-names.ts";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const PER_HOUR = 1;
const DAYS = 2;
export const EXPECTED_TOTAL = PER_HOUR * 24 * DAYS;

const widgetsPath = (project: string) => `/api/v1/projects/${project}/analytics/dashboard-widgets`;
/** Dashboards V2 boards; the legacy /api/dashboards table cannot hold widgets. */
const boardsPath = (project: string) => `/api/v1/projects/${project}/analytics/boards`;
const chartsPath = (project: string) => `/api/v1/projects/${project}/analytics/charts`;

type WidgetKind = "count" | "slowest" | "errors";

interface WorldSpec {
  board: string;
  widgets: WidgetKind[];
  /** A board the scenario must leave alone. */
  decoy?: string;
  decoyWidgets?: WidgetKind[];
  /** A valid second choice of board (A1). */
  other?: string;
  /** The widget the scenario acts on, by name. */
  target?: string;
}

export const MATRIX_WORLDS = {
  D1: { board: "Checkout health", decoy: "Weekly review", decoyWidgets: ["count"], widgets: [] },
  D2: { board: "Checkout health", widgets: ["count", "slowest"], target: "Traces this period" },
  A1: { board: "Checkout health", other: "Weekly review", widgets: [] },
  D3: { board: "Checkout health", widgets: [] },
  X1: { board: "Checkout health", widgets: ["count", "slowest", "errors"], target: "Error count" },
  D5: { board: "Checkout health", widgets: ["count"], target: "Traces this period" },
  // B1: a board asked about by its id; read-only, so every fact should stay unchanged.
  B1: { board: "Release review", widgets: ["count", "errors"] },
} as const satisfies Record<MatrixWorld, WorldSpec>;

// ── state and facts (snake_case: the judge and the scenarios read these keys by name) ──

interface WidgetRef {
  id: string;
  name: string;
}

interface BoardRef {
  id: string;
  name: string;
  widgets: WidgetRef[];
}

interface Window {
  start: number;
  end: number;
}

export interface WorldState {
  world: MatrixWorld;
  tag: string;
  trace_name: string;
  seeded_traces: number;
  expected_total: number;
  expected_days: number;
  window: Window;
  board: BoardRef;
  decoy?: BoardRef;
  other_board?: BoardRef;
  target_widget?: WidgetRef;
  baseline_item_ids: string[];
  initial_digests: Record<string, string>;
  baseline_alert_ids: string[];
}

interface Resource {
  id: string;
  name?: string;
  dashboardId?: string | null;
  definition?: {
    sql?: string;
    parameters?: Record<string, unknown> | null;
    queries?: { sql?: string; parameters?: { name: string; default?: unknown }[] | null }[];
  };
  [key: string]: unknown;
}

export interface Item {
  kind: "widget" | "chart" | "graph";
  resource: Resource;
}

export interface Alert {
  kind: "trigger" | "monitor";
  id: string;
  name?: string;
  raw: Record<string, unknown>;
}

interface BoardFacts {
  items: number;
  added: { kind: Item["kind"]; name?: string }[];
  changed_ids: string[];
  removed_names: string[];
  unchanged: boolean;
  newest_counts?: CountResult;
}

export interface Facts {
  board?: BoardFacts;
  decoy?: BoardFacts;
  other_board?: BoardFacts;
  created_off_board: { kind: Item["kind"]; name?: string }[];
  items_created_this_run: number;
  target_widget?: { exists: boolean; same_id_changed: boolean };
  /** Every alert, old or new, whose definition names the target widget's id. */
  alerts_on_target?: { kind: Alert["kind"]; id: string; name?: string }[];
  other_widgets_unchanged?: boolean;
  new_alerts: { kind: Alert["kind"]; id: string; name?: string }[];
}

type CountResult = { total: number | null; rows: number | null; errors?: string[] };

const RUN_BOARD_KEYS = ["board", "decoy", "other_board"] as const;

function runBoards({
  state,
}: {
  state: WorldState;
}): Partial<Record<(typeof RUN_BOARD_KEYS)[number], string>> {
  return Object.fromEntries(
    RUN_BOARD_KEYS.flatMap((key) => (state[key] ? [[key, state[key].id]] : [])),
  );
}

function onRunBoard({ item, state }: { item: Item; state: WorldState }): boolean {
  return Object.values(runBoards({ state })).includes(item.resource.dashboardId ?? "");
}

/** JSON with sorted keys at every level, so a digest ignores key order. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value).toSorted(([a], [b]) => a.localeCompare(b, "en"));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function digest({ resource }: { resource: unknown }): string {
  return createHash("sha1").update(stableJson(resource)).digest("hex").slice(0, 12);
}

/** The code checks of the matrix, from what the public API returns, never from what Langy said. */
export function buildFacts({
  items,
  alerts,
  state,
}: {
  items: Item[];
  alerts: Alert[];
  state: WorldState;
}): Facts {
  const baseline = new Set(state.baseline_item_ids);
  const initial = state.initial_digests;
  const boards = runBoards({ state });
  const facts: Facts = { created_off_board: [], items_created_this_run: 0, new_alerts: [] };

  for (const key of RUN_BOARD_KEYS) {
    const boardId = boards[key];
    const board = state[key];
    if (!boardId || !board) continue;
    const current = items.filter((item) => item.resource.dashboardId === boardId);
    const ids = new Set(current.map((item) => item.resource.id));
    const added = current.filter((item) => !(item.resource.id in initial));
    const changed = current
      .filter((item) => item.resource.id in initial)
      .filter((item) => digest({ resource: item.resource }) !== initial[item.resource.id])
      .map((item) => item.resource.id);
    const removed = board.widgets.filter((widget) => !ids.has(widget.id)).map((w) => w.name);
    facts[key] = {
      items: current.length,
      added: added.map((item) => ({ kind: item.kind, name: item.resource.name })),
      changed_ids: changed,
      removed_names: removed,
      unchanged: added.length === 0 && changed.length === 0 && removed.length === 0,
    };
  }

  const offBoard = items.filter(
    (item) =>
      !baseline.has(item.resource.id) &&
      !onRunBoard({ item, state }) &&
      JSON.stringify(item.resource).includes(state.tag),
  );
  facts.created_off_board = offBoard.map((item) => ({ kind: item.kind, name: item.resource.name }));
  facts.items_created_this_run =
    RUN_BOARD_KEYS.reduce((sum, key) => sum + (facts[key]?.added.length ?? 0), 0) + offBoard.length;

  const target = state.target_widget;
  if (target) {
    const match = items.find((item) => item.resource.id === target.id);
    facts.target_widget = {
      exists: match !== undefined,
      same_id_changed:
        match !== undefined && digest({ resource: match.resource }) !== initial[target.id],
    };
    facts.alerts_on_target = alerts
      .filter((alert) => JSON.stringify(alert.raw).includes(target.id))
      .map(({ kind, id, name }) => ({ kind, id, name }));
    facts.other_widgets_unchanged = state.board.widgets
      .filter((widget) => widget.id !== target.id)
      .every((widget) =>
        items.some(
          (item) =>
            item.resource.id === widget.id &&
            digest({ resource: item.resource }) === initial[widget.id],
        ),
      );
  }

  // Only this run's alerts: another run of the plan may make one at the same time. An alert on a
  // run's graph names the graph's id, not the tag.
  const baselineAlerts = new Set(state.baseline_alert_ids);
  const runRefs = [
    state.tag,
    ...Object.values(boards),
    ...items.filter((item) => onRunBoard({ item, state })).map((item) => item.resource.id),
  ];
  facts.new_alerts = alerts
    .filter(
      (alert) =>
        !baselineAlerts.has(alert.id) &&
        runRefs.some((ref) => JSON.stringify(alert.raw).includes(ref)),
    )
    .map(({ kind, id, name }) => ({ kind, id, name }));
  return facts;
}

/** The last full UTC day before now and the day before it, `[start, end)` in ms. */
export function dailyWindows({ nowMs }: { nowMs: number }): { previous: Window; day: Window } {
  const today = Math.floor(nowMs / DAY_MS) * DAY_MS;
  return {
    previous: { start: today - 2 * DAY_MS, end: today - DAY_MS },
    day: { start: today - DAY_MS, end: today },
  };
}

const TIME_LIKE = ["bucket", "day", "date", "time", "hour", "period", "week"];
const COUNT_LIKE = ["count", "trace", "total", "volume", "events"];

const isNumeric = (value: unknown): boolean =>
  (typeof value === "number" && Number.isFinite(value)) ||
  (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value)));

/** The sum of a result's count column: numeric, not a time bucket, a count-like name first. */
export function totalOf({ rows }: { rows: Record<string, unknown>[] }): number | null {
  const first = rows[0];
  if (!first) return null;
  const columns = Object.keys(first).filter(
    (column) =>
      !TIME_LIKE.some((t) => column.toLowerCase().includes(t)) &&
      rows.every((row) => isNumeric(row[column])),
  );
  const column =
    columns.find((c) => COUNT_LIKE.some((t) => c.toLowerCase().includes(t))) ?? columns[0];
  if (column === undefined) return null;
  return rows.reduce((sum, row) => sum + Number(row[column]), 0);
}

// ── the public API calls ──

const iso = (ms: number) => new Date(ms).toISOString();

export async function query({
  http,
  sql,
  window,
  grain,
  parameters = {},
}: {
  http: LangWatchHttp;
  sql: string;
  window?: Window;
  grain?: number;
  parameters?: Record<string, unknown>;
}): Promise<{ rows: Record<string, unknown>[] | null; error: string | null }> {
  const answer = await http.request<{ rows?: Record<string, unknown>[] }>({
    method: "POST",
    path: "/api/v1/query",
    body: {
      sql,
      projectId: http.projectId,
      parameters,
      ...(window ? { timeWindow: { start: iso(window.start), end: iso(window.end) } } : {}),
      ...(grain ? { granularitySeconds: grain } : {}),
    },
  });
  if (answer.status >= 400) return { rows: null, error: answer.text.slice(0, 300) };
  return { rows: answer.body.rows ?? [], error: null };
}

function countWidget({
  name,
  traceName,
  select,
}: {
  name: string;
  traceName: string;
  select: string;
}) {
  return {
    name,
    code: `export default function Widget() {
  const { data, isLoading, isError, error } = LW.useChartQuery("main", {});
  if (isError) return <div>{error.message}</div>;
  if (isLoading || data === null) return <div>Loading...</div>;
  const row = data[0] || {};
  const value = Object.values(row)[0];
  return <div style={{ fontSize: 32 }}>{String(value ?? 0)}</div>;
}`,
    queries: [
      {
        name: "main",
        sql:
          `SELECT ${select} FROM traces WHERE TraceName = '${traceName}' ` +
          "AND OccurredAt >= {dashboard_context_period_start:DateTime} " +
          "AND OccurredAt < {dashboard_context_period_end:DateTime}",
      },
    ],
  };
}

function widgetSpec({ kind, traceName }: { kind: WidgetKind; traceName: string }) {
  if (kind === "count")
    return countWidget({ name: "Traces this period", traceName, select: "count() AS traces" });
  if (kind === "slowest")
    return countWidget({
      name: "Slowest traces",
      traceName,
      select: "max(TotalDurationMs) AS slowest_ms",
    });
  return countWidget({
    name: "Error count",
    traceName,
    select: "countIf(ContainsErrorStatus) AS errors",
  });
}

/** One trace, two model calls (the lookup is the root), as `seedTraffic` sends it. */
export async function sendTrace({
  http,
  traceId,
  traceName,
  started,
  order,
}: {
  http: LangWatchHttp;
  traceId: string;
  traceName: string;
  started: number;
  order: number;
}): Promise<void> {
  const duration = 800 + (order % 9) * 1_100;
  const half = Math.floor(duration / 2);
  const question = `customer support question #${order}: where is my order?`;
  const span = (spanId: string, start: number, output: string, parent: string | null) => ({
    trace_id: traceId,
    span_id: spanId,
    parent_id: parent,
    type: "llm",
    name: traceName,
    model: "gpt-5-mini",
    input: { type: "text", value: question },
    output: { type: "text", value: output },
    timestamps: { started_at: start, finished_at: started + duration },
  });
  const lookup = `${traceId}_lookup`;
  const answer = await http.request({
    method: "POST",
    path: "/api/collector",
    body: {
      trace_id: traceId,
      spans: [
        span(lookup, started, "Looking up the order.", null),
        span(
          `${traceId}_answer`,
          started + half,
          `Your order #10${order} is out for delivery.`,
          lookup,
        ),
      ],
      metadata: { labels: ["e2e-seed", "langy-hooks-dogfood"] },
    },
  });
  expectOk({ answer, what: "send trace" });
}

/** PER_HOUR traces in every UTC hour of both full days; returns how many read back. */
async function seedTraffic({
  http,
  traceName,
  nowMs,
  deadlineMs = 35_000,
}: {
  http: LangWatchHttp;
  traceName: string;
  nowMs: number;
  deadlineMs?: number;
}): Promise<number> {
  const { previous, day } = dailyWindows({ nowMs });
  let order = 0;
  for (const [label, window] of [
    ["previous", previous],
    ["day", day],
  ] as const) {
    for (let hour = 0; hour < 24; hour++) {
      for (let i = 0; i < PER_HOUR; i++) {
        const started =
          window.start + hour * HOUR_MS + Math.floor(((i + 0.5) * HOUR_MS) / PER_HOUR);
        await sendTrace({
          http,
          traceId: `${traceName}_${label}_${hour}_${i}`,
          traceName,
          started,
          order,
        });
        order++;
      }
    }
  }
  // The collector projects asynchronously: wait until the traces count back.
  const end = Date.now() + deadlineMs;
  let seen = 0;
  while (Date.now() < end) {
    const result = await query({
      http,
      sql: `SELECT count() AS n FROM traces WHERE TraceName = '${traceName}'`,
    });
    seen = Number(result.rows?.[0]?.n ?? 0);
    if (seen >= order) break;
    await sleep(2_000);
  }
  return seen;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function listItems({ http }: { http: LangWatchHttp }): Promise<Item[]> {
  const widgets = await http.request<{ data?: Resource[] }>({
    method: "GET",
    path: widgetsPath(http.projectId),
  });
  const charts = await http.request<{ data?: Resource[] }>({
    method: "GET",
    path: chartsPath(http.projectId),
  });
  const graphs = await http.request<Resource[]>({ method: "GET", path: "/api/graphs" });
  return [
    ...(expectOk({ answer: widgets, what: "list widgets" }).data ?? []).map((resource) => ({
      kind: "widget" as const,
      resource,
    })),
    ...(expectOk({ answer: charts, what: "list charts" }).data ?? []).map((resource) => ({
      kind: "chart" as const,
      resource,
    })),
    // Classic custom graphs: Langy can still pin one to a board, with an alert on it.
    ...expectOk({ answer: graphs, what: "list graphs" }).map((resource) => ({
      kind: "graph" as const,
      resource,
    })),
  ];
}

/** Triggers and monitors: what "an alert" can become. */
async function listAlerts({ http }: { http: LangWatchHttp }): Promise<Alert[]> {
  const out: Alert[] = [];
  for (const [kind, path] of [
    ["trigger", "/api/triggers"],
    ["monitor", "/api/monitors"],
  ] as const) {
    const answer = await http.request<
      Record<string, unknown>[] | { data?: Record<string, unknown>[] }
    >({ method: "GET", path });
    if (answer.status !== 200) continue;
    const rows = Array.isArray(answer.body) ? answer.body : (answer.body.data ?? []);
    out.push(
      ...rows.map((raw) => ({
        kind,
        id: String(raw.id),
        name: raw.name as string | undefined,
        raw,
      })),
    );
  }
  return out;
}

/** What a new item counts over the seeded days, one bucket per day (board-state.ts countOf). */
async function countItem({
  http,
  item,
  state,
}: {
  http: LangWatchHttp;
  item: Item;
  state: WorldState;
}): Promise<CountResult> {
  const definition = item.resource.definition ?? {};
  // A widget binds each parameter's default, as its Run button does; a chart its saved values.
  const statements =
    item.kind === "chart"
      ? [{ sql: definition.sql ?? "", parameters: definition.parameters ?? {} }]
      : (definition.queries ?? []).map((q) => ({
          sql: q.sql ?? "",
          parameters: Object.fromEntries(
            (q.parameters ?? []).filter((p) => "default" in p).map((p) => [p.name, p.default]),
          ),
        }));
  let ranEmpty = false;
  const errors: string[] = [];
  for (const { sql, parameters } of statements) {
    const result = await query({ http, sql, window: state.window, grain: 86_400, parameters });
    if (result.rows === null) {
      errors.push(result.error ?? "");
      continue;
    }
    if (result.rows.length === 0) {
      ranEmpty = true;
      continue;
    }
    const total = totalOf({ rows: result.rows });
    if (total !== null) return { total, rows: result.rows.length };
  }
  if (ranEmpty) return { total: 0, rows: 0 };
  return { total: null, rows: null, errors: errors.slice(0, 2) };
}

/** Reads the facts now: the items and alerts, then what the newest widget on the board counts. */
export async function readFacts({
  http,
  state,
}: {
  http: LangWatchHttp;
  state: WorldState;
}): Promise<Facts> {
  const items = await listItems({ http });
  const facts = buildFacts({ items, alerts: await listAlerts({ http }), state });
  const added = items.filter(
    (item) =>
      item.resource.dashboardId === state.board.id && !(item.resource.id in state.initial_digests),
  );
  const newest = added.at(-1);
  if (facts.board && newest)
    facts.board.newest_counts = await countItem({ http, item: newest, state });
  return facts;
}

/** Builds the world a matrix row needs and returns its state: references only, no data. */
export async function setupWorld({
  http,
  world,
}: {
  http: LangWatchHttp;
  world: MatrixWorld;
}): Promise<WorldState> {
  const spec: WorldSpec = MATRIX_WORLDS[world];
  const tag = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  const traceName = `checkout-${tag}`;
  const nowMs = Date.now();
  const seen = await seedTraffic({ http, traceName, nowMs });
  const { previous, day } = dailyWindows({ nowMs });

  const board = async (name: string, kinds: readonly WidgetKind[]): Promise<BoardRef> => {
    const boardName = `${name} ${tag}`;
    const created = await http.request<{ id: string }>({
      method: "POST",
      path: boardsPath(http.projectId),
      body: { name: boardName },
    });
    const boardId = expectOk({ answer: created, what: "create board" }).id;
    const widgets: WidgetRef[] = [];
    for (const kind of kinds) {
      const made = await http.request<WidgetRef>({
        method: "POST",
        path: widgetsPath(http.projectId),
        body: widgetSpec({ kind, traceName }),
      });
      const widget = expectOk({ answer: made, what: "create widget" });
      const placed = await http.request({
        method: "POST",
        path: `${widgetsPath(http.projectId)}/${widget.id}/dashboard`,
        body: { dashboardId: boardId },
      });
      expectOk({ answer: placed, what: "place widget" });
      widgets.push({ id: widget.id, name: widget.name });
    }
    return { id: boardId, name: boardName, widgets };
  };

  const mainBoard = await board(spec.board, spec.widgets);
  const state: WorldState = {
    world,
    tag,
    trace_name: traceName,
    seeded_traces: seen,
    expected_total: EXPECTED_TOTAL,
    expected_days: DAYS,
    window: { start: previous.start, end: day.end },
    board: mainBoard,
    ...(spec.decoy ? { decoy: await board(spec.decoy, spec.decoyWidgets ?? []) } : {}),
    ...(spec.other ? { other_board: await board(spec.other, []) } : {}),
    ...(spec.target
      ? { target_widget: mainBoard.widgets.find((w) => w.name === spec.target) }
      : {}),
    baseline_item_ids: [],
    initial_digests: {},
    baseline_alert_ids: [],
  };
  const items = await listItems({ http });
  state.baseline_item_ids = items.map((item) => item.resource.id);
  state.initial_digests = Object.fromEntries(
    items
      .filter((item) => onRunBoard({ item, state }))
      .map((item) => [item.resource.id, digest({ resource: item.resource })]),
  );
  state.baseline_alert_ids = (await listAlerts({ http })).map((alert) => alert.id);
  return state;
}

/** Deletes the widgets the run made or touched; a chart has no delete route, so it stays. */
async function deleteRunItems({
  http,
  state,
  deleted,
  left,
}: {
  http: LangWatchHttp;
  state: WorldState;
  deleted: string[];
  left: string[];
}): Promise<void> {
  const baseline = new Set(state.baseline_item_ids);
  for (const item of await listItems({ http })) {
    const id = item.resource.id;
    const ours =
      onRunBoard({ item, state }) ||
      (!baseline.has(id) && JSON.stringify(item.resource).includes(state.tag));
    if (!ours) continue;
    if (item.kind === "chart") {
      left.push(`chart ${id} (no chart delete route)`);
      continue;
    }
    const path =
      item.kind === "graph" ? `/api/graphs/${id}` : `${widgetsPath(http.projectId)}/${id}`;
    const answer = await http.request({ method: "DELETE", path });
    (answer.status < 300 ? deleted : left).push(id);
  }
}

/** The final facts, then removes everything the run made except the traces. */
export async function teardownWorld({ http, state }: { http: LangWatchHttp; state: WorldState }) {
  const finalFacts = await readFacts({ http, state });
  const deleted: { widgets: string[]; dashboards: string[]; alerts: string[] } = {
    widgets: [],
    dashboards: [],
    alerts: [],
  };
  const left: string[] = [];
  await deleteRunItems({ http, state, deleted: deleted.widgets, left });
  for (const boardId of Object.values(runBoards({ state }))) {
    const answer = await http.request({
      method: "DELETE",
      path: `${boardsPath(http.projectId)}/${boardId}`,
    });
    (answer.status < 300 ? deleted.dashboards : left).push(boardId);
  }
  for (const alert of finalFacts.new_alerts) {
    const base = alert.kind === "trigger" ? "/api/triggers" : "/api/monitors";
    const answer = await http.request({ method: "DELETE", path: `${base}/${alert.id}` });
    (answer.status < 300 ? deleted.alerts : left).push(alert.id);
  }
  return {
    final_facts: finalFacts,
    deleted,
    left_behind: {
      items: left,
      traces: `${state.seeded_traces} traces named ${state.trace_name} (no trace delete route)`,
    },
  };
}
