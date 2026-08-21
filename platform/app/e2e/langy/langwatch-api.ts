// Direct LangWatch HTTP helpers for Layer 2 (side-effect) verification.
// These bypass Langy/MCP and hit the LangWatch app at LW_BASE_URL with the
// project API key, so a passing call here proves the entity actually
// landed in the backend regardless of what Langy claimed.

import { LANGWATCH_API_KEY, LW_BASE_URL } from "./config";

const LW_BASE = LW_BASE_URL;
const LW_KEY = LANGWATCH_API_KEY;

/** How long seeded traces get to become queryable before the suite gives up. */
const INGESTION_VISIBILITY_TIMEOUT_MS = 60_000;

async function lwGet(path: string): Promise<any> {
  const res = await fetch(`${LW_BASE}${path}`, {
    headers: { "X-Auth-Token": LW_KEY },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(
      `GET ${path} -> ${res.status}: ${(await res.text()).slice(0, 200)}`,
    );
  }
  return res.json();
}

async function lwPost({
  path,
  body,
}: {
  path: string;
  body: unknown;
}): Promise<any> {
  const res = await fetch(`${LW_BASE}${path}`, {
    method: "POST",
    headers: { "X-Auth-Token": LW_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(
      `POST ${path} -> ${res.status}: ${(await res.text()).slice(0, 200)}`,
    );
  }
  return res.json();
}

// Normalize the various list payload shapes ({ data: [...] }, a bare array, or
// neither) to an array, so downstream .map/.filter never throws on an object.
function toArray<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (
    payload &&
    typeof payload === "object" &&
    "data" in payload &&
    Array.isArray((payload as { data?: unknown }).data)
  ) {
    return (payload as { data: T[] }).data;
  }
  return [];
}

export async function listDatasets(): Promise<
  Array<{ id: string; name: string; recordCount: number }>
> {
  return toArray(await lwGet("/api/dataset"));
}

export async function listAgents(): Promise<
  Array<{ id: string; name: string }>
> {
  return toArray(await lwGet("/api/agents"));
}

export async function listEvaluators(): Promise<
  Array<{ id: string; name: string }>
> {
  return toArray(await lwGet("/api/evaluators"));
}

export async function listScenarios(): Promise<
  Array<{ id: string; name: string }>
> {
  return toArray(await lwGet("/api/scenarios"));
}

export async function listPrompts(): Promise<
  Array<{ id: string; name?: string; handle?: string }>
> {
  return toArray(await lwGet("/api/prompts"));
}

export async function listMonitors(): Promise<
  Array<{ id: string; name?: string }>
> {
  return toArray(await lwGet("/api/monitors"));
}

/**
 * Seeds an evaluator for the delete scenario, so the deletion has a known,
 * suite-owned target rather than gambling on whatever the project contains.
 * The `evaluatorType` must be one the platform validates
 * (`langevals/exact_match` costs nothing and needs no model config).
 */
export async function createEvaluator(
  name: string,
): Promise<{ id: string; name: string }> {
  return lwPost({
    path: "/api/evaluators",
    body: { name, config: { evaluatorType: "langevals/exact_match" } },
  });
}

/**
 * Teardown for the delete scenario's seeded evaluator, for the runs where
 * Langy failed to delete it (which is exactly the failing case, so the leak
 * happens precisely when the suite is red). Already-gone is the desired end
 * state — on a passing run Langy removed it during the scenario.
 */
export async function deleteEvaluator(id: string): Promise<void> {
  const response = await fetch(`${LW_BASE}/api/evaluators/${id}`, {
    method: "DELETE",
    headers: { "X-Auth-Token": LW_KEY },
    signal: AbortSignal.timeout(15_000),
  });
  if (response.ok || response.status === 404) return;
  throw new Error(
    `Failed to delete seeded evaluator ${id}: ${response.status} ${response.statusText}`,
  );
}

/**
 * Cleanup for the monitor scenario. The suite runs with a full project key,
 * so it can tidy up regardless of what the scenario under test managed to do.
 *
 * A monitor that is already gone (404) is the desired end state, not a failure.
 * Everything else throws. Swallowing the error would be worse than a noisy
 * teardown: the monitor stays live on the project's traffic, evaluating every
 * ingested trace and spending real money, and the run that leaked it reports
 * success. A failed cleanup has to be visible to be fixed.
 */
export async function deleteMonitor(id: string): Promise<void> {
  const response = await fetch(`${LW_BASE}/api/monitors/${id}`, {
    method: "DELETE",
    headers: { "X-Auth-Token": LW_KEY },
    signal: AbortSignal.timeout(15_000),
  });
  if (response.ok || response.status === 404) return;
  throw new Error(
    `Failed to delete monitor ${id}: ${response.status} ${response.statusText}. ` +
      "It is still live on the project and will keep evaluating traffic until removed.",
  );
}

export async function listDashboards(): Promise<
  Array<{ id: string; name?: string }>
> {
  return toArray(await lwGet("/api/dashboards"));
}

export async function listWorkflows(): Promise<
  Array<{ id: string; name?: string }>
> {
  return toArray(await lwGet("/api/workflows"));
}

/**
 * A real, currently-existing trace id, for scenarios that need to give Langy
 * something concrete to act on (e.g. annotate a trace) without depending on
 * Langy's own trace-search tool finding it first — see the "Langy's own
 * trace search returns 0 hits" follow-up finding for why that isn't reliable
 * yet. Wide date range (2020 -> now+1yr) so this never itself goes empty.
 */
export async function mostRecentTraceId(): Promise<string | null> {
  const result = await lwPost({
    path: "/api/traces/search",
    body: {
      startDate: new Date("2020-01-01").getTime(),
      endDate: Date.now() + 365 * 24 * 60 * 60 * 1000,
      pageSize: 1,
      format: "json",
    },
  });
  const traces = toArray<{ trace_id?: string }>(result?.traces ?? result);
  return traces[0]?.trace_id ?? null;
}

/**
 * Whether a trace with this exact id exists in the project. Layer-2 grounding
 * check: a scenario that saw Langy report trace ids asserts they are real
 * through the same REST surface any integration would use, instead of asking
 * the LLM judge to verify ids it has no evidence for.
 */
export async function traceExists(traceId: string): Promise<boolean> {
  const result = await lwPost({
    path: "/api/traces/search",
    body: {
      startDate: new Date("2020-01-01").getTime(),
      endDate: Date.now() + 365 * 24 * 60 * 60 * 1000,
      traceIds: [traceId],
      pageSize: 5,
      format: "json",
    },
  });
  const traces = toArray<{ trace_id?: string }>(result?.traces ?? result);
  return traces.some((t) => t.trace_id === traceId);
}

export async function listAnnotations(): Promise<
  Array<{ id: string; traceId?: string; comment?: string }>
> {
  return toArray(await lwGet("/api/annotations"));
}

export async function listTriggers(): Promise<
  Array<{ id: string; name?: string; active?: boolean }>
> {
  return toArray(await lwGet("/api/triggers"));
}

/**
 * Seeds application-origin traffic into the project so data questions
 * ("how much traffic", "what's my p95") have a true answer.
 *
 * Without this, a fresh local project only contains Langy's own mirrored
 * runs (origin: langy), which rule 27 makes Langy exclude — so "no traces
 * in the last 24h" is CORRECT, and any judge that expects a non-zero count
 * is grading against data that does not exist. Spans carry no
 * langwatch.origin, which the platform coalesces to "application".
 *
 * Returns only once the seeded traces are QUERYABLE, not merely accepted. The
 * collector acks before indexing completes, so returning on the ack raced the
 * first data scenario against ingestion: the ground truth was still zero, Langy
 * correctly answered "no traffic", and the suite recorded a Langy defect that
 * was really a timing artifact. A false red here is the one failure this suite
 * must never produce, because it is read as evidence about the agent.
 */
export async function seedApplicationTraces(count = 8): Promise<void> {
  const now = Date.now();
  const traceIds = Array.from(
    { length: count },
    (_, i) => `trace_e2e_seed_${now}_${i}`,
  );
  const posts = Array.from({ length: count }, (_, i) => {
    const startedAt = now - (i + 1) * 60_000;
    // Varied latencies (0.8s–9.6s) so p95 is a real figure, one error span.
    const durationMs = 800 + i * 1_100 + (i % 3) * 200;
    return lwPost({
      path: "/api/collector",
      body: {
        spans: [
          {
            trace_id: traceIds[i],
            span_id: `span_e2e_seed_${now}_${i}`,
            type: "llm",
            model: "gpt-5-mini",
            input: {
              type: "text",
              value: `customer support question #${i}: where is my order?`,
            },
            output:
              i === count - 1
                ? undefined
                : {
                    type: "text",
                    value: `Your order #10${i} is out for delivery.`,
                  },
            error:
              i === count - 1
                ? {
                    message: "upstream model timeout after 30s",
                    stacktrace: [],
                    has_error: true,
                  }
                : undefined,
            timestamps: {
              started_at: startedAt,
              finished_at: startedAt + durationMs,
            },
          },
        ],
        metadata: { labels: ["e2e-seed"] },
      },
    });
  });
  await Promise.all(posts);

  // Poll every seeded id, not a first/last bracket. The posts above go out
  // concurrently, so the order they were generated in says nothing about the
  // order they are indexed in: both ends can be queryable while a trace in the
  // middle is still missing, and the data scenarios would then read a short
  // batch as the ground truth.
  const deadline = Date.now() + INGESTION_VISIBILITY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const visible = await Promise.all(traceIds.map(traceExists));
    if (visible.every(Boolean)) return;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  throw new Error(
    `Seeded traces were still not queryable after ${
      INGESTION_VISIBILITY_TIMEOUT_MS / 1_000
    }s. This is ingestion lag in the environment, NOT a Langy defect — the ` +
      "data scenarios would have graded an empty index as a wrong answer.",
  );
}
