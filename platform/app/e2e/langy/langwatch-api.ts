// Direct LangWatch HTTP helpers for Layer 2 (side-effect) verification.
// These bypass Langy/MCP and hit the LangWatch app at LW_BASE_URL with the
// project API key, so a passing call here proves the entity actually
// landed in the backend regardless of what Langy claimed.

import { LANGWATCH_API_KEY, LW_BASE_URL } from "./config";

const LW_BASE = LW_BASE_URL;
const LW_KEY = LANGWATCH_API_KEY;

/** How long seeded traces get to become queryable before the suite gives up. */
const INGESTION_VISIBILITY_TIMEOUT_MS = 60_000;

/**
 * An HTTP error status. Its own type, not a message shape: the retry loop
 * below decides on the class, so rewording the message can never turn a real
 * answer back into something worth retrying.
 */
class LwHttpError extends Error {}

/**
 * Retried fetch for the verification helpers: on a loaded machine a single
 * request has stalled in front of the app past any sane one-shot budget while
 * a fresh attempt answered instantly, so three short attempts beat one long
 * wait. Only timeouts and network errors retry — an HTTP error status is a
 * real answer and throws straight away.
 */
async function lwFetch({
  path,
  init,
}: {
  path: string;
  init: RequestInit;
}): Promise<any> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${LW_BASE}${path}`, {
        ...init,
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) {
        throw new LwHttpError(
          `${init.method ?? "GET"} ${path} -> ${res.status}: ${(await res.text()).slice(0, 200)}`,
        );
      }
      return res.json();
    } catch (error) {
      if (error instanceof LwHttpError) throw error;
      lastError = error;
      // A stalled attempt is retried against the same loaded machine, so give
      // it a moment rather than firing all three inside a few milliseconds.
      if (attempt < 2) {
        await new Promise((resolve) =>
          setTimeout(resolve, 500 * (attempt + 1)),
        );
      }
    }
  }
  throw lastError;
}

async function lwGet(path: string): Promise<any> {
  return lwFetch({ path, init: { headers: { "X-Auth-Token": LW_KEY } } });
}

async function lwPost({
  path,
  body,
}: {
  path: string;
  body: unknown;
}): Promise<any> {
  return lwFetch({
    path,
    init: {
      method: "POST",
      headers: { "X-Auth-Token": LW_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  });
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
  Array<{ id: string; name: string; config?: { evaluatorType?: string } }>
> {
  return toArray(await lwGet("/api/evaluators"));
}

/**
 * The named evaluator, created through the API when the project does not have
 * it yet. A scenario premise that names a resource seeds it here so the premise
 * holds on any project state, and a rerun reuses the existing one.
 */
export async function ensureEvaluator({
  name,
  evaluatorType,
}: {
  name: string;
  evaluatorType: string;
}): Promise<void> {
  const existing = (await listEvaluators()).find(
    (evaluator) => evaluator.name === name,
  );
  // The name alone does not make it the right fixture. A retained evaluator of
  // a DIFFERENT type leaves the scenario asserting against the wrong resource
  // while the premise reads as satisfied, so the type is checked too, and a
  // mismatch is replaced rather than reused. The type is what the API keeps
  // under config.evaluatorType; the top-level `type` is the record kind
  // ("evaluator" for everything created here) and cannot tell them apart.
  if (existing) {
    if (existing.config?.evaluatorType === evaluatorType) return;
    await deleteEvaluator(existing.id);
  }
  await lwPost({
    path: "/api/evaluators",
    body: { name, config: { evaluatorType } },
  });
}

/**
 * Deletes an evaluator by id. Already-gone (404) is the desired end state, not
 * a failure — the callers are cleanup paths that run precisely when a run went
 * wrong, so the resource being absent already is success. Everything else
 * throws; swallowing the error would hide the leak this exists to prevent.
 */
export async function deleteEvaluator(id: string): Promise<void> {
  const response = await fetch(`${LW_BASE}/api/evaluators/${id}`, {
    method: "DELETE",
    headers: { "X-Auth-Token": LW_KEY },
    signal: AbortSignal.timeout(15_000),
  });
  if (response.ok || response.status === 404) return;
  throw new Error(
    `Failed to delete evaluator ${id}: ${response.status} ${response.statusText}.`,
  );
}

/**
 * Evaluators the reset below must never remove: scenario premises seed them by
 * name (ensureEvaluator) and expect them present on any project state.
 */
const SEEDED_EVALUATOR_NAMES = new Set(["e2e-offtopic"]);

/**
 * Restores the project's designed evaluation state: zero monitors, and no
 * evaluators beyond the seeded fixtures. Scenarios that create monitors or
 * evaluators call this before AND after the conversation. Before, because a
 * leftover from a crashed earlier run changes the model's behavior (finding a
 * monitor matching the request, it correctly asks reuse-versus-create instead
 * of creating, and the judge grades a branch the criteria do not describe).
 * After, because a leaked live monitor evaluates every ingested trace and
 * spends real money until someone notices.
 */
export async function resetEvaluationResources(): Promise<void> {
  // allSettled, not all: every deletion must be ATTEMPTED even when an earlier
  // one fails. Under Promise.all the first rejected monitor delete skipped the
  // evaluator sweep entirely, which is the leak this function exists to stop.
  // The failures are collected and raised once every attempt is in.
  const monitors = await listMonitors();
  const monitorResults = await Promise.allSettled(
    monitors.map((monitor) => deleteMonitor(monitor.id)),
  );
  const evaluators = await listEvaluators();
  const evaluatorResults = await Promise.allSettled(
    evaluators
      .filter((evaluator) => !SEEDED_EVALUATOR_NAMES.has(evaluator.name))
      .map((evaluator) => deleteEvaluator(evaluator.id)),
  );
  const failures = [...monitorResults, ...evaluatorResults]
    .filter((result) => result.status === "rejected")
    .map((result) => (result as PromiseRejectedResult).reason);
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      `resetEvaluationResources: ${failures.length} deletion(s) failed`,
    );
  }
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
 * runs (origin: langy), which AGENTS.md's trace-origins rule makes Langy
 * exclude ("Your own runs carry `langy`: exclude them unless the user asks
 * about you") — so "no traces
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
