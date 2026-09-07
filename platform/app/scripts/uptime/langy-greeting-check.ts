/**
 * The Langy greeting check: one turn, one verdict.
 *
 * This is the source of truth for what the uptime monitor calls "healthy".
 * `buildGreetingRequest` shapes the request `POST /api/langy/conversations`
 * accepts (see `~/server/routes/langy-api.ts`), `classifyGreetingResponse`
 * reads the answer, and `runLangyGreetingCheck` does both over a fetch.
 *
 * The Better Stack script next door (`langy-greeting.betterstack.js`) mirrors
 * this module and is pinned to it by a drift test; it cannot import it because
 * the monitor runs a pasted, self-contained file.
 *
 * Why a fresh idempotency key per check matters: the platform resolves a
 * repeated key for the same project and user to the turn it already ran
 * (`langy-turn-admission.prisma.repository.ts`), without running the assistant
 * again. A monitor reusing a key replays its first check forever and stays
 * green through an outage.
 *
 * Spec: specs/langy/langy-uptime-greeting-monitor.feature
 */

export const LANGY_GREETING_TEXT = "Hi Langy.";

/**
 * Under the 60s Better Stack request timeout the monitor is provisioned with,
 * and well under the platform's own 120s wait ceiling: a hung turn fails the
 * check as `not_settled` instead of the monitor timing out first.
 */
export const LANGY_GREETING_WAIT_SECONDS = 30;

export const LANGY_CONVERSATIONS_PATH = "/api/langy/conversations";

export const GREETING_FAILURE_REASONS = [
  "not_settled",
  "turn_failed",
  "empty_reply",
  "surface_dark",
  "unauthorized",
  "forbidden",
  "unexpected_status",
  "malformed_body",
  "unreachable",
] as const;

export type GreetingFailureReason = (typeof GREETING_FAILURE_REASONS)[number];

export type GreetingRequest = {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: string;
};

export type GreetingOutcome =
  | {
      healthy: true;
      status: 200;
      conversationId: string;
      turnId: string;
      replyText: string;
    }
  | {
      healthy: false;
      reason: GreetingFailureReason;
      status: number | null;
      detail: string;
      conversationId?: string;
      turnId?: string;
    };

export type GreetingCheckResult = GreetingOutcome & {
  idempotencyKey: string;
  durationMs: number;
};

export function buildGreetingRequest(input: {
  baseUrl: string;
  apiKey: string;
  idempotencyKey: string;
}): GreetingRequest {
  const base = input.baseUrl.replace(/\/+$/, "");
  return {
    url: `${base}${LANGY_CONVERSATIONS_PATH}`,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Auth-Token": input.apiKey,
      Prefer: `wait=${LANGY_GREETING_WAIT_SECONDS}`,
    },
    body: JSON.stringify({
      messages: [{ role: "user", content: LANGY_GREETING_TEXT }],
      idempotencyKey: input.idempotencyKey,
    }),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * Turn a status and parsed body into the one verdict the monitor alerts on.
 *
 * Only a 200 whose `reply.text` is a non-empty string is healthy. A 200 is
 * also what a FAILED turn returns (the request succeeded; the turn did not),
 * so status alone proves nothing — the body decides.
 */
export function classifyGreetingResponse(input: {
  status: number;
  body: unknown;
}): GreetingOutcome {
  const { status, body } = input;
  const envelope = isRecord(body) ? body : undefined;
  const ids = {
    conversationId: readString(envelope?.conversationId),
    turnId: readString(envelope?.turnId),
  };

  if (status === 200) return classifySettled(envelope, ids);
  if (status === 202) {
    return {
      healthy: false,
      reason: "not_settled",
      status,
      detail: `turn accepted but not settled within ${LANGY_GREETING_WAIT_SECONDS}s`,
      ...ids,
    };
  }
  return classifyRefusal(status, envelope);
}

/** A 200 is a settled turn; the body says whether the turn itself succeeded. */
function classifySettled(
  envelope: Record<string, unknown> | undefined,
  ids: { conversationId?: string; turnId?: string },
): GreetingOutcome {
  const status = 200;
  const { conversationId, turnId } = ids;
  if (!envelope || !conversationId || !turnId) {
    return {
      healthy: false,
      reason: "malformed_body",
      status,
      detail: "200 without a turn envelope (conversationId, turnId)",
    };
  }
  const reply = isRecord(envelope.reply) ? envelope.reply : null;
  const replyText = readString(reply?.text);
  if (replyText === undefined) {
    return {
      healthy: false,
      reason: "turn_failed",
      status,
      detail: describeTurnError(envelope),
      conversationId,
      turnId,
    };
  }
  if (replyText.trim().length === 0) {
    return {
      healthy: false,
      reason: "empty_reply",
      status,
      detail: "reply.text is empty",
      conversationId,
      turnId,
    };
  }
  return { healthy: true, status, conversationId, turnId, replyText };
}

const REFUSAL_BY_STATUS: Record<
  number,
  { reason: GreetingFailureReason; fallback: string }
> = {
  404: {
    reason: "surface_dark",
    fallback:
      "route answered 404: API-key turns flag off or route not deployed",
  },
  401: { reason: "unauthorized", fallback: "credential missing or invalid" },
  403: {
    reason: "forbidden",
    fallback: "key lacks langy:create or its owner has no Langy access",
  },
};

function classifyRefusal(
  status: number,
  envelope: Record<string, unknown> | undefined,
): GreetingOutcome {
  const known = REFUSAL_BY_STATUS[status];
  const reason = known?.reason ?? "unexpected_status";
  const fallback = known?.fallback ?? `unexpected status ${status}`;
  // A dark surface's 404 body is whatever the router says; the flag is the fact.
  const detail =
    reason === "surface_dark"
      ? fallback
      : (describeErrorEnvelope(envelope) ?? fallback);
  return { healthy: false, reason, status, detail };
}

function describeTurnError(envelope: Record<string, unknown>): string {
  const turnStatus = readString(envelope.status) ?? "unknown";
  const error = envelope.error;
  const message = isRecord(error)
    ? (readString(error.message) ?? JSON.stringify(error))
    : readString(error);
  return message
    ? `turn ${turnStatus}: ${message}`
    : `turn ${turnStatus} with no reply`;
}

function describeErrorEnvelope(
  envelope: Record<string, unknown> | undefined,
): string | undefined {
  if (!envelope) return undefined;
  const error = envelope.error;
  if (isRecord(error)) {
    const code = readString(error.code);
    const message = readString(error.message);
    if (code && message) return `${code}: ${message}`;
    return message ?? code;
  }
  return readString(error) ?? readString(envelope.message);
}

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ status: number; text(): Promise<string> }>;

/**
 * Run one check. Never throws: every way the request can go wrong is a named
 * unhealthy outcome, because the monitor's job is to say what broke, and a
 * thrown error says only that something did.
 */
export async function runLangyGreetingCheck(input: {
  baseUrl: string;
  apiKey: string;
  fetch?: FetchLike;
  mintKey?: () => string;
  now?: () => number;
}): Promise<GreetingCheckResult> {
  const doFetch = input.fetch ?? (globalThis.fetch as unknown as FetchLike);
  const mintKey = input.mintKey ?? (() => globalThis.crypto.randomUUID());
  const now = input.now ?? (() => Date.now());

  const idempotencyKey = mintKey();
  const request = buildGreetingRequest({
    baseUrl: input.baseUrl,
    apiKey: input.apiKey,
    idempotencyKey,
  });
  const started = now();

  let status: number;
  let text: string;
  try {
    const response = await doFetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
    });
    status = response.status;
    text = await response.text();
  } catch (error) {
    return {
      healthy: false,
      reason: "unreachable",
      status: null,
      detail: error instanceof Error ? error.message : String(error),
      idempotencyKey,
      durationMs: now() - started,
    };
  }
  const durationMs = now() - started;

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return {
      healthy: false,
      reason: "malformed_body",
      status,
      detail: `response body is not JSON (${text.length} bytes)`,
      idempotencyKey,
      durationMs,
    };
  }

  const outcome = classifyGreetingResponse({ status, body });
  return {
    ...outcome,
    // An upstream error message may echo the header it rejected; the detail
    // lands in the monitor's incident timeline, so the key is scrubbed here,
    // where it is known, and nowhere downstream needs to know it.
    ...(outcome.healthy
      ? {}
      : { detail: outcome.detail.split(input.apiKey).join(REDACTED_SECRET) }),
    idempotencyKey,
    durationMs,
  };
}

export const REDACTED_SECRET = "<redacted>";

/**
 * One log line per check. Carries ids and timing so a red check can be found
 * in the platform; carries no credential, because this line lands in the
 * monitor's incident timeline.
 */
export function formatGreetingCheckResult(result: GreetingCheckResult): string {
  const base = {
    healthy: result.healthy,
    status: result.status,
    durationMs: result.durationMs,
    idempotencyKey: result.idempotencyKey,
    conversationId: result.conversationId ?? null,
    turnId: result.turnId ?? null,
  };
  if (result.healthy) {
    return JSON.stringify({ ...base, replyChars: result.replyText.length });
  }
  return JSON.stringify({
    ...base,
    reason: result.reason,
    detail: result.detail,
  });
}
