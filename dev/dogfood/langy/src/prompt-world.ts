/**
 * The default world: a prompt `e2e-<id>` whose text holds a marker phrase, and errored traces
 * that share one unique error message. Scenarios "Langy reads a prompt" and "Langy explains
 * failing traces" ask about them.
 */
import { expectOk, type LangWatchHttp } from "./http.ts";

const TRACE_COUNT = 3;

export interface PromptWorldState {
  prompt_id: string;
  prompt_handle: string;
  marker: string;
  trace_ids: string[];
  error_message: string;
  traces_searchable: boolean;
}

export function isPromptWorldState(state: unknown): state is PromptWorldState {
  return (
    typeof state === "object" &&
    state !== null &&
    typeof (state as PromptWorldState).prompt_id === "string"
  );
}

async function sendErroredTrace({
  http,
  traceId,
  errorMessage,
  atMs,
}: {
  http: LangWatchHttp;
  traceId: string;
  errorMessage: string;
  atMs: number;
}): Promise<void> {
  const answer = await http.request({
    method: "POST",
    path: "/api/collector",
    body: {
      trace_id: traceId,
      spans: [
        {
          type: "llm",
          span_id: `${traceId}-llm`,
          name: "chat-completion",
          model: "gpt-4.1-mini",
          input: {
            type: "chat_messages",
            value: [{ role: "user", content: "Where is my order?" }],
          },
          error: { has_error: true, message: errorMessage, stacktrace: [] },
          timestamps: { started_at: atMs, finished_at: atMs + 1500 },
        },
      ],
      metadata: { user_id: "langy-hooks-dogfood", labels: ["langy-hooks-dogfood"] },
    },
  });
  expectOk({ answer, what: "send errored trace" });
}

/** The collector projects asynchronously; Langy can only find a trace once it reads back. */
async function waitUntilSearchable({
  http,
  traceIds,
  deadlineMs,
}: {
  http: LangWatchHttp;
  traceIds: string[];
  deadlineMs: number;
}): Promise<boolean> {
  const end = Date.now() + deadlineMs;
  const pending = new Set(traceIds);
  while (pending.size > 0 && Date.now() < end) {
    for (const traceId of pending) {
      const answer = await http.request({ method: "GET", path: `/api/traces/${traceId}` });
      if (answer.status === 200) pending.delete(traceId);
    }
    if (pending.size > 0) await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  return pending.size === 0;
}

export async function setupPromptWorld({
  http,
  scenarioRunId,
}: {
  http: LangWatchHttp;
  scenarioRunId: string;
}): Promise<PromptWorldState> {
  const runId = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const marker = `PINEAPPLE-${runId.toUpperCase()}`;
  const handle = `e2e-${runId}`;
  const errorMessage = `PaymentGatewayTimeout: card processor did not answer (ref ${runId})`;
  const created = await http.request<{ id: string }>({
    method: "POST",
    path: "/api/prompts",
    body: {
      handle,
      prompt: `You are a shop assistant. Always end every answer with the phrase ${marker}.`,
      commitMessage: `dogfood setup for ${scenarioRunId}`,
    },
  });
  const prompt = expectOk({ answer: created, what: "create prompt" });
  const nowMs = Date.now();
  const traceIds = Array.from({ length: TRACE_COUNT }, (_, n) => `e2e-${runId}-trace-${n}`);
  for (const [n, traceId] of traceIds.entries()) {
    await sendErroredTrace({ http, traceId, errorMessage, atMs: nowMs - (n + 1) * 60_000 });
  }
  return {
    prompt_id: prompt.id,
    prompt_handle: handle,
    marker,
    trace_ids: traceIds,
    error_message: errorMessage,
    traces_searchable: await waitUntilSearchable({ http, traceIds, deadlineMs: 40_000 }),
  };
}

/** Deletes the prompt. The traces stay: the public API has no trace delete route. */
export async function teardownPromptWorld({
  http,
  state,
}: {
  http: LangWatchHttp;
  state: PromptWorldState;
}) {
  const removed = await http.request({ method: "DELETE", path: `/api/prompts/${state.prompt_id}` });
  const after = await http.request({ method: "GET", path: `/api/prompts/${state.prompt_id}` });
  return {
    deleted: { prompt: removed.status === 200, prompt_gone: after.status === 404 },
    left_behind: { traces: state.trace_ids, why: "no trace delete route" },
  };
}
