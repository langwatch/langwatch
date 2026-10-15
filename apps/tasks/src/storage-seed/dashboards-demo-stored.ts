/**
 * What a project already holds, asked of the stack's own read APIs. The trace, log and
 * experiment doors count a repeat again once their short dedup has lapsed, and a repeat the
 * other doors do keep apart still costs the stack its work, so a re-run sends only what is new.
 */
import type { DemoHttp } from "./dashboards-demo-http.ts";

const DAY_MS = 86_400_000;
const SEARCH_PAGE = 1_000;
/** The most rows one query answers; a longer list is paged. */
const QUERY_PAGE = 10_000;
/** The trace door keeps 31 days; two more cover a trace that began just before its cut. */
const SEARCH_DAYS = 33;
/** A search leaves Langy's own turns out unless it names their origin, so it asks twice. */
const SEARCH_FILTERS = [undefined, "origin:langy"] as const;

interface SearchPage {
  traces: { trace_id: string }[];
  pagination: { scrollId?: string | null };
}

interface QueryPage {
  rows: Record<string, string>[];
}

/** Every trace id the project holds within the trace door's reach, Langy's turns included. */
export async function storedTraceIds({
  http,
  now,
}: {
  http: DemoHttp;
  now: number;
}): Promise<ReadonlySet<string>> {
  const ids = new Set<string>();
  for (const filter of SEARCH_FILTERS) {
    let scrollId: string | undefined;
    do {
      const page = await http.json<SearchPage>({
        method: "POST",
        path: "/api/traces/search",
        body: {
          startDate: now - SEARCH_DAYS * DAY_MS,
          endDate: now + DAY_MS,
          pageSize: SEARCH_PAGE,
          from: "traces",
          select: ["trace_id"],
          ...(filter ? { filter } : {}),
          ...(scrollId ? { scrollId } : {}),
        },
      });
      for (const trace of page.traces) ids.add(trace.trace_id);
      scrollId =
        page.traces.length < SEARCH_PAGE ? undefined : (page.pagination.scrollId ?? undefined);
    } while (scrollId);
  }
  return ids;
}

/** The views that list what a project holds, each with the column that names one of its rows. */
const ID_COLUMNS = {
  coding_sessions: "SessionId",
  experiment_run_results: "RunId",
  gateway_request_spend: "GatewayRequestId",
  simulations: "ScenarioRunId",
} as const;

/** Every row id the project holds in a query view, whatever its age. */
export async function storedIds({
  http,
  view,
  where,
}: {
  http: DemoHttp;
  view: keyof typeof ID_COLUMNS;
  /** Narrows "held" to rows that are complete, so a half-written one is sent again. */
  where?: string;
}): Promise<ReadonlySet<string>> {
  const column = ID_COLUMNS[view];
  const filter = where ? ` WHERE ${where}` : "";
  const ids = new Set<string>();
  let offset = 0;
  let rows: QueryPage["rows"];
  do {
    const page = await http.json<QueryPage>({
      method: "POST",
      path: "/api/v1/query",
      body: {
        sql: `SELECT DISTINCT ${column} FROM ${view}${filter} ORDER BY ${column} LIMIT ${QUERY_PAGE} OFFSET ${offset}`,
      },
    });
    rows = page.rows;
    offset += rows.length;
    for (const row of rows) {
      const id = row[column];
      if (id) ids.add(id);
    }
  } while (rows.length === QUERY_PAGE);
  return ids;
}
