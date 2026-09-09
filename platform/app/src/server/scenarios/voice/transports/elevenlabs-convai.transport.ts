/**
 * The ElevenLabs Conversational AI transport.
 *
 * This is the ONE module in the codebase that names ElevenLabs or touches the
 * ElevenLabs SDK. Everything above it speaks of a `VoiceTransport` and a
 * `VoiceTransportRunner`; the vendor coupling — the SDK adapter, the connect
 * handshake, the two customer-facing failure strings — is sealed in here.
 */

import type { AgentAdapter } from "@langwatch/scenario";
import * as ScenarioRunner from "@langwatch/scenario";
import type { CallRecord, CallTurn } from "../call-record";
import { VOICE_HTTP_TIMEOUT_MS } from "../voice-limits";
import type {
  VoiceTransportCredential,
  VoiceTransportRunner,
} from "../voice-transport.registry";

/**
 * How long to wait for the socket to open before failing the run. ElevenLabs
 * can reject a bad agent id by closing the socket, or a network fault can hang
 * the connect; either way the run must fail well inside the AC's 60 seconds
 * rather than sit until the child's 15-minute outer timeout.
 */
export const ELEVENLABS_CONNECT_TIMEOUT_MS = 45_000;

/** Shown on a run when the project has no ElevenLabs key. */
export const NO_ELEVENLABS_KEY_MESSAGE = "No ElevenLabs key in this project";

/** Prefix for a run whose ElevenLabs socket was refused or never opened. */
export const ELEVENLABS_CONNECT_REJECTED_PREFIX =
  "ElevenLabs rejected the connection";

function reasonOf(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message;
  return String(error);
}

/** The subset of ElevenLabs' error envelope this helper can read a message
 *  from. `detail` is a string, an object with `message`, or an array of
 *  `{ msg }` (FastAPI validation-error shape) depending on the endpoint. */
interface ElevenLabsErrorBody {
  detail?: string | { message?: string } | Array<{ msg?: string }>;
}

/**
 * Turn a non-2xx ElevenLabs response into a customer-facing reason: the
 * provider's own message when the body carries one, else a bare status-code
 * fallback. Never reads or echoes the API key.
 */
export function readElevenLabsErrorReason(
  status: number,
  bodyText: string,
): string {
  const fallback = `Status code: ${status}`;
  if (!bodyText) return fallback;
  let body: ElevenLabsErrorBody;
  try {
    body = JSON.parse(bodyText) as ElevenLabsErrorBody;
  } catch {
    return fallback;
  }
  const { detail } = body;
  if (typeof detail === "string" && detail.length > 0) return detail;
  if (Array.isArray(detail)) {
    const message = detail.find((entry) => typeof entry?.msg === "string")?.msg;
    if (message) return message;
  } else if (
    detail &&
    typeof detail === "object" &&
    typeof detail.message === "string" &&
    detail.message.length > 0
  ) {
    return detail.message;
  }
  return fallback;
}

/** Reject `promise` if it has not settled within `timeoutMs`, running
 *  `onTimeout` (best-effort, errors swallowed) the moment it fires so a
 *  caller can release whatever the still-pending promise was holding. */
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout?: () => void,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          onTimeout?.();
          reject(new Error(`connection timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Replace an adapter's `connect()` so a transport-level failure surfaces as the
 * run's error with the mandated prefix instead of a raw socket error, and can
 * never hang past `timeoutMs`. On the timeout path specifically, the adapter's
 * own socket is still open with nobody waiting on it, so `disconnect()` is
 * called best-effort to release it (#31); a disconnect failure is swallowed so
 * the customer-facing timeout message still wins. Exported so the exact
 * message is unit-tested against a throwing inner without a live socket.
 */
export function wrapConnectRejection<
  T extends { connect: () => Promise<void> },
>(adapter: T, timeoutMs: number = ELEVENLABS_CONNECT_TIMEOUT_MS): T {
  const original = adapter.connect.bind(adapter);
  adapter.connect = async () => {
    try {
      await withTimeout(original(), timeoutMs, () => {
        void (adapter as { disconnect?: () => Promise<void> })
          .disconnect?.()
          .catch(() => {
            // Best-effort only: the timeout error below is what the caller sees.
          });
      });
    } catch (error) {
      throw new Error(
        `${ELEVENLABS_CONNECT_REJECTED_PREFIX}: ${reasonOf(error)}`,
      );
    }
  };
  return adapter;
}

/**
 * The signed-URL mint and the conversation read talk to ElevenLabs directly
 * from the control plane, not through the AI Gateway data plane. Two reasons:
 * the gateway terminates virtual-key *traffic* (chat/completions), it has no
 * signed-URL door for the control plane to call with a project key; and "Talk
 * to it" is explicitly outside the gateway's guardrails (the panel says so),
 * so routing it through the gateway would misrepresent what it is. The key is
 * read server-side and only the short-lived signed URL is handed to the
 * browser — the credential never crosses the boundary either way.
 */
const SIGNED_URL_PATH = "/v1/convai/conversation/get-signed-url";
const CONVERSATION_PATH = "/v1/convai/conversations";
const API_KEY_HEADER = "xi-api-key";

interface ElevenLabsTranscriptEntry {
  role?: string;
  message?: string | null;
  time_in_call_secs?: number;
}

interface ElevenLabsConversationResponse {
  conversation_id?: string;
  agent_id?: string;
  status?: string;
  transcript?: ElevenLabsTranscriptEntry[];
  metadata?: {
    start_time_unix_secs?: number;
    call_duration_secs?: number;
  };
  has_audio?: boolean;
}

function authHeaders(credential: VoiceTransportCredential): HeadersInit {
  return { [API_KEY_HEADER]: credential.apiKey, accept: "application/json" };
}

/**
 * A malicious or compromised upstream could hand back a `signed_url` pointing
 * anywhere; the browser connects to it directly with no further checks, so it
 * is validated here before it ever reaches the client. Accepts only a secure
 * websocket on ElevenLabs' own domain, or the project's configured (regional)
 * base host.
 */
export function isAcceptableSignedUrl({
  signedUrl,
  baseUrl,
}: {
  signedUrl: string;
  baseUrl: string;
}): boolean {
  let url: URL;
  let base: URL;
  try {
    url = new URL(signedUrl);
    base = new URL(baseUrl);
  } catch {
    return false;
  }
  if (url.protocol !== "wss:") return false;
  return (
    url.hostname === "elevenlabs.io" ||
    url.hostname.endsWith(".elevenlabs.io") ||
    url.hostname === base.hostname
  );
}

/** Map an ElevenLabs transcript entry to a neutral turn. `agent` → agent,
 *  anything else (`user`) → the human caller. */
function toTurn(entry: ElevenLabsTranscriptEntry): CallTurn {
  return {
    role: entry.role === "agent" ? "agent" : "caller",
    text: (entry.message ?? "").trim(),
    startMs:
      typeof entry.time_in_call_secs === "number"
        ? entry.time_in_call_secs * 1000
        : undefined,
  };
}

export const elevenLabsConvaiTransport: VoiceTransportRunner = {
  missingKeyMessage: NO_ELEVENLABS_KEY_MESSAGE,

  async mintSession({ agentId, credential }) {
    const url = `${credential.baseUrl}${SIGNED_URL_PATH}?agent_id=${encodeURIComponent(
      agentId,
    )}`;
    let response: Response;
    try {
      response = await fetch(url, {
        headers: authHeaders(credential),
        signal: AbortSignal.timeout(VOICE_HTTP_TIMEOUT_MS),
      });
    } catch (error) {
      throw new Error(
        `${ELEVENLABS_CONNECT_REJECTED_PREFIX}: ${reasonOf(error)}`,
      );
    }
    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");
      throw new Error(
        `${ELEVENLABS_CONNECT_REJECTED_PREFIX}: ${readElevenLabsErrorReason(
          response.status,
          bodyText,
        )}`,
      );
    }
    const body = (await response.json()) as { signed_url?: string };
    if (!body.signed_url) {
      throw new Error(
        `${ELEVENLABS_CONNECT_REJECTED_PREFIX}: no signed URL returned`,
      );
    }
    if (
      !isAcceptableSignedUrl({
        signedUrl: body.signed_url,
        baseUrl: credential.baseUrl,
      })
    ) {
      throw new Error(
        `${ELEVENLABS_CONNECT_REJECTED_PREFIX}: signed URL rejected`,
      );
    }
    return { signedUrl: body.signed_url };
  },

  async fetchCallRecord({ conversationId, credential, audioProxyUrl }) {
    const url = `${credential.baseUrl}${CONVERSATION_PATH}/${encodeURIComponent(
      conversationId,
    )}`;
    const response = await fetch(url, {
      headers: authHeaders(credential),
      signal: AbortSignal.timeout(VOICE_HTTP_TIMEOUT_MS),
    });
    // Not ready yet: the record does not exist for this conversation. The
    // caller falls back to the live transcript rather than treating it as a
    // fetch failure.
    if (response.status === 404) return null;
    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");
      throw new Error(
        `ElevenLabs conversation fetch failed: ${readElevenLabsErrorReason(
          response.status,
          bodyText,
        )}`,
      );
    }
    const body = (await response.json()) as ElevenLabsConversationResponse;
    const startedAt = body.metadata?.start_time_unix_secs
      ? body.metadata.start_time_unix_secs * 1000
      : Date.now();
    const durationMs = (body.metadata?.call_duration_secs ?? 0) * 1000;
    const record: CallRecord = {
      conversationId,
      transport: "elevenlabs_convai",
      ...(body.agent_id ? { agentExternalId: body.agent_id } : {}),
      startedAt,
      endedAt: startedAt + durationMs,
      durationMs,
      turns: (body.transcript ?? [])
        .filter((entry) => (entry.message ?? "").trim().length > 0)
        .map(toTurn),
      isCutAtLimit: false,
      source: "provider",
    };
    // Audio bytes carry the key to fetch, so they are streamed through the app
    // proxy rather than exposed as an ElevenLabs URL. No audio → no Play
    // control, no error (AC15).
    if (body.has_audio) record.audioUrl = audioProxyUrl;
    return record;
  },

  async endCall(adapter): Promise<void> {
    // The SDK adapter exposes `disconnect()`; the cast is sealed in this one
    // vendor module rather than living at the child's call site.
    await (adapter as { disconnect?: () => Promise<void> }).disconnect?.();
  },

  createAgentAdapter({ agentId, credential, maxCallSeconds }): AgentAdapter {
    // No prompt/first-message overrides: passing them drops the agent's own
    // tool ids server-side (scenario#838). The key rides only into the SDK
    // adapter here — never onto the job payload's events or logs.
    const adapter = ScenarioRunner.voice.elevenLabsAgent({
      agentId,
      apiKey: credential.apiKey,
    });
    // A single agent turn should never out-wait the whole-call budget the
    // child enforces; clamp the per-turn wait to it. The whole-call cut is the
    // child's timer, not a knob on the adapter.
    adapter.responseTimeout = Math.min(adapter.responseTimeout, maxCallSeconds);
    return wrapConnectRejection(adapter);
  },
};
