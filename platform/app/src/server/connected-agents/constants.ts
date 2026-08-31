/**
 * The caps and clocks of connected agents (ADR-128), in one place.
 *
 * Payload caps are sized for multimodal turns: a turn carries the whole
 * conversation, and a message can carry base64 images and audio. A self-hosted
 * deployment raises them with `LANGWATCH_AGENT_RELAY_MAX_PAYLOAD_MB`.
 */

const MEBIBYTE = 1024 * 1024;

/** The envelope cap when no override is set, in mebibytes. */
export const DEFAULT_RELAY_MAX_PAYLOAD_MB = 32;

/** What a result may weigh relative to the envelope cap. */
const RESULT_CAP_RATIO = 0.5;

/** What a socket frame may weigh relative to the envelope cap. */
const FRAME_CAP_RATIO = 2;

/** The `session` value an agent keeps per conversation, in bytes. */
export const SESSION_MAX_BYTES = 64 * 1024;

/** Every cap that derives from the envelope cap, resolved together. */
export interface RelayPayloadCaps {
  /** The relay request body and the call envelope, in bytes. */
  envelopeBytes: number;
  /** The output plus session an instance answers with, in bytes. */
  resultBytes: number;
  /** The `session` value alone, in bytes. */
  sessionBytes: number;
  /** One WebSocket frame, in bytes; never below the envelope cap. */
  frameBytes: number;
}

/**
 * The caps for one deployment.
 *
 * Read per call rather than at module load so a test can set the override
 * without reloading the module, and so the gateway and the relay route read
 * the same number.
 */
export function relayPayloadCaps(
  overrideMb: number | undefined = readOverrideMb(),
): RelayPayloadCaps {
  const envelopeMb =
    overrideMb !== undefined && Number.isFinite(overrideMb) && overrideMb > 0
      ? overrideMb
      : DEFAULT_RELAY_MAX_PAYLOAD_MB;
  const envelopeBytes = Math.floor(envelopeMb * MEBIBYTE);
  return {
    envelopeBytes,
    resultBytes: Math.floor(envelopeBytes * RESULT_CAP_RATIO),
    sessionBytes: SESSION_MAX_BYTES,
    frameBytes: Math.max(envelopeBytes, envelopeBytes * FRAME_CAP_RATIO),
  };
}

/** The override as the process environment states it, or nothing. */
function readOverrideMb(): number | undefined {
  const raw = process.env.LANGWATCH_AGENT_RELAY_MAX_PAYLOAD_MB;
  if (raw === undefined || raw.trim() === "") return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** The server pings every connected socket this often. */
export const PING_INTERVAL_MS = 15_000;

/** A socket that answers no ping inside this window is gone. */
export const PONG_WAIT_MS = 10_000;

/** How long an instance stays live without a presence refresh. */
export const PRESENCE_TTL_SECONDS = 30;

/** How often presence is refreshed while the socket answers pings. */
export const PRESENCE_REFRESH_MS = 10_000;

/** How long a poll of the HTTP transport waits for a frame before it answers empty. */
export const POLL_WAIT_MS = 25_000;

/**
 * How long an HTTP session outlives its last poll. Longer than the presence
 * TTL on purpose: a process that missed a few polls reads Offline meanwhile
 * and resumes with the same token, with no second register.
 */
export const HTTP_SESSION_TTL_SECONDS = 5 * 60;

/** The per-call budget when the agent declares none. */
export const DEFAULT_CALL_TIMEOUT_MS = 120_000;

/** The per-call budget an agent can never exceed. */
export const MAX_CALL_TIMEOUT_MS = 300_000;

/** How long the first call of a thread waits for an instance to appear. */
export const FIRST_TURN_GRACE_MS = 15_000;

/** How often the dispatcher looks for an instance inside the grace. */
export const FIRST_TURN_POLL_MS = 2_000;

/** How often the dispatcher reads the result key when no nudge arrived. */
export const RESULT_POLL_MS = 1_000;

/** How long a result stays readable after the instance wrote it. */
export const RESULT_TTL_SECONDS = 60;

/** Slack added to the deadline on the envelope and pending keys. */
export const CALL_KEY_SLACK_SECONDS = 60;

/** How long a sticky pin outlives the last call of its thread. */
export const STICKY_PIN_TTL_SECONDS = 10 * 60;

/** `Agent.lastSeenAt` is written at most once per agent in this window. */
export const LAST_SEEN_WRITE_INTERVAL_MS = 60_000;

/** The concurrency an instance advertises when it says nothing, per kind. */
export const DEFAULT_CONCURRENCY_DEVELOPMENT = 1;
export const DEFAULT_CONCURRENCY_SHARED = 4;

/** The delay a full agent asks the caller to wait before it tries again. */
export const BUSY_RETRY_AFTER_MS = 2_000;

/** The names the SDK sends on every call; never a run parameter. */
export const TURN_FIELD_NAMES = new Set([
  "messages",
  "new_messages",
  "newMessages",
  "thread_id",
  "threadId",
  "session",
  "trace_id",
  "traceId",
  "params",
]);
