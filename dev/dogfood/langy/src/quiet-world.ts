import type { LangWatchHttp } from "./http.ts";
import { QUIET_WORLD } from "./world-names.ts";
/**
 * World W1: the user asks about the last 2 hours, and the newest trace is about 7 hours old.
 * Traces carry a per-run name, so the question and the facts ignore other traffic.
 */
import { query, sendTrace } from "./worlds.ts";

const HOUR_MS = 3_600_000;
const NEWEST_AGE_HOURS = 7;
const TRACE_COUNT = 5;

export interface QuietWorldState {
  world: typeof QUIET_WORLD;
  tag: string;
  trace_name: string;
  seeded_traces: number;
  newest_trace_age_hours_at_setup: number;
}

export function isQuietWorldState(state: unknown): state is QuietWorldState {
  return (
    typeof state === "object" && state !== null && (state as QuietWorldState).world === QUIET_WORLD
  );
}

/** Hours between now and a ClickHouse DateTime (`YYYY-MM-DD hh:mm:ss[.fff]`, UTC) or ISO string. */
export function ageInHours({ newest, nowMs }: { newest: unknown; nowMs: number }): number | null {
  if (typeof newest !== "string" || newest.trim() === "") return null;
  const iso = newest.includes("T") ? newest : `${newest.replace(" ", "T")}Z`;
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return null;
  return Math.round(((nowMs - at) / HOUR_MS) * 10) / 10;
}

async function readNewest({ http, traceName }: { http: LangWatchHttp; traceName: string }) {
  const result = await query({
    http,
    sql: `SELECT count() AS n, toString(max(OccurredAt)) AS newest FROM traces WHERE TraceName = '${traceName}'`,
  });
  const row = result.rows?.[0] ?? {};
  return {
    count: Number(row.n ?? 0),
    newest_trace_age_hours: ageInHours({ newest: row.newest, nowMs: Date.now() }),
  };
}

export async function setupQuietWorld({ http }: { http: LangWatchHttp }): Promise<QuietWorldState> {
  const tag = crypto.randomUUID().replace(/-/g, "").slice(0, 6);
  const traceName = `quiet-${tag}`;
  const nowMs = Date.now();
  for (let n = 0; n < TRACE_COUNT; n++) {
    const started = nowMs - (NEWEST_AGE_HOURS + n) * HOUR_MS;
    await sendTrace({ http, traceId: `${traceName}_${n}`, traceName, started, order: n });
  }
  const end = Date.now() + 35_000;
  let read = await readNewest({ http, traceName });
  while (read.count < TRACE_COUNT && Date.now() < end) {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    read = await readNewest({ http, traceName });
  }
  return {
    world: QUIET_WORLD,
    tag,
    trace_name: traceName,
    seeded_traces: read.count,
    newest_trace_age_hours_at_setup: read.newest_trace_age_hours ?? NEWEST_AGE_HOURS,
  };
}

export async function readQuietFacts({
  http,
  state,
}: {
  http: LangWatchHttp;
  state: QuietWorldState;
}) {
  return readNewest({ http, traceName: state.trace_name });
}

/** Nothing to delete but traces, which have no delete route: the facts and what stays. */
export async function teardownQuietWorld({
  http,
  state,
}: {
  http: LangWatchHttp;
  state: QuietWorldState;
}) {
  return {
    final_facts: await readQuietFacts({ http, state }),
    deleted: {},
    left_behind: {
      traces: `${state.seeded_traces} traces named ${state.trace_name} (no trace delete route)`,
    },
  };
}
