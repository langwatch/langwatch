/**
 * The ElevenLabs Conversational AI transport — the ONE module naming
 * ElevenLabs or touching its SDK. Everything above speaks of
 * `VoiceTransport`; the vendor coupling is sealed in here.
 */

import { createLogger } from "@langwatch/observability";
import type { AgentAdapter } from "@langwatch/scenario";
import * as ScenarioRunner from "@langwatch/scenario";
import { nowInstant } from "@langwatch/time";

import { VoiceCallRecordNotReadyError } from "../../scenario.errors.ts";
import type { CallRecord, CallTurn } from "../call-record.ts";
import { VOICE_HTTP_TIMEOUT_MS } from "../voice-limits.ts";
import type {
  VoiceTransportCredential,
  VoiceTransportRunner,
} from "../voice-transport.registry.ts";

const logger = createLogger("langwatch:scenarios:voice:elevenlabs");

/**
 * How long to wait for the socket to open before failing the run. ElevenLabs
 * can reject a bad agent id or hang on a network fault; either way the run
 * must fail inside the AC's 60s rather than the child's 15-minute timeout.
 */
export const ELEVENLABS_CONNECT_TIMEOUT_MS = 45_000;

/** Shown on a run when the project has no ElevenLabs key. */
export const NO_ELEVENLABS_KEY_MESSAGE = "No ElevenLabs key in this project";

/** Prefix for a run whose ElevenLabs socket was refused or never opened. */
export const ELEVENLABS_CONNECT_REJECTED_PREFIX = "ElevenLabs rejected the connection";

function reasonOf(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message;
  return String(error);
}

/** The subset of ElevenLabs' error envelope this helper can read a message
 *  from. `detail` is a string, an object with `message`, or an array of
 *  `{ msg }` (FastAPI validation-error shape) depending on the endpoint. */
interface ElevenLabsErrorBody {
  detail?: string | { message?: string } | { msg?: string }[];
}

/**
 * Turn a non-2xx ElevenLabs response into a customer-facing reason: the
 * provider's own message when the body carries one, else a bare status-code
 * fallback. Never reads or echoes the API key.
 */
export function readElevenLabsErrorReason(status: number, bodyText: string): string {
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

/** Wrap adapter connect to prefix transport failures; timeout with
 * best-effort disconnect; exported so message is unit-tested.
 */
export function wrapConnectRejection<T extends { connect: () => Promise<void> }>(
  adapter: T,
  timeoutMs: number = ELEVENLABS_CONNECT_TIMEOUT_MS,
): T {
  const original = adapter.connect.bind(adapter);
  adapter.connect = async () => {
    try {
      await withTimeout(original(), timeoutMs, () => {
        void (adapter as { disconnect?: () => Promise<void> }).disconnect?.().catch(() => {
          // Best-effort only: the timeout error below is what the caller sees.
        });
      });
    } catch (error) {
      throw new Error(`${ELEVENLABS_CONNECT_REJECTED_PREFIX}: ${reasonOf(error)}`);
    }
  };
  return adapter;
}

/** Signed-URL mint and conversation read call ElevenLabs direct from control
 * plane, not gateway: gateway has no signed-URL door, routing misrepresents it.
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

/** The ElevenLabs branch of the transport credential union, or a thrown error.
 *  Every method here reads an API key and host; a credential built for another
 *  transport reaching this runner is a wiring bug, so it fails loudly rather
 *  than being read as a shape it is not. */
function elevenLabsCredentialOf(credential: VoiceTransportCredential): {
  apiKey: string;
  baseUrl: string;
} {
  if (credential.kind !== "elevenlabs") {
    throw new Error(`ElevenLabs transport received a ${credential.kind} credential`);
  }
  return { apiKey: credential.apiKey, baseUrl: credential.baseUrl };
}

function authHeaders(credential: { apiKey: string }): Record<string, string> {
  return { [API_KEY_HEADER]: credential.apiKey, accept: "application/json" };
}

/**
 * A compromised upstream could hand back a `signed_url` pointing anywhere
 * the browser then connects to unchecked, so it is validated here: only a
 * secure websocket on ElevenLabs' domain or the project's base host is accepted.
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
      typeof entry.time_in_call_secs === "number" ? entry.time_in_call_secs * 1000 : undefined,
  };
}

export const elevenLabsConvaiTransport: VoiceTransportRunner = {
  missingKeyMessage: NO_ELEVENLABS_KEY_MESSAGE,

  async mintSession({ agentId, credential }) {
    const el = elevenLabsCredentialOf(credential);
    const url = `${el.baseUrl}${SIGNED_URL_PATH}?agent_id=${encodeURIComponent(agentId)}`;
    let response: Response;
    try {
      response = await fetch(url, {
        headers: authHeaders(el),
        signal: AbortSignal.timeout(VOICE_HTTP_TIMEOUT_MS),
      });
    } catch (error) {
      throw new Error(`${ELEVENLABS_CONNECT_REJECTED_PREFIX}: ${reasonOf(error)}`);
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
      throw new Error(`${ELEVENLABS_CONNECT_REJECTED_PREFIX}: no signed URL returned`);
    }
    if (
      !isAcceptableSignedUrl({
        signedUrl: body.signed_url,
        baseUrl: el.baseUrl,
      })
    ) {
      throw new Error(`${ELEVENLABS_CONNECT_REJECTED_PREFIX}: signed URL rejected`);
    }
    return { signedUrl: body.signed_url };
  },

  async getCallRecord({ conversationId, credential, audioProxyUrl }) {
    const el = elevenLabsCredentialOf(credential);
    const url = `${el.baseUrl}${CONVERSATION_PATH}/${encodeURIComponent(conversationId)}`;
    const response = await fetch(url, {
      headers: authHeaders(el),
      signal: AbortSignal.timeout(VOICE_HTTP_TIMEOUT_MS),
    });
    // Not ready yet: the caller keeps the live transcript, not a fetch failure.
    if (response.status === 404) throw new VoiceCallRecordNotReadyError({ conversationId });
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
    // Right after hang-up ElevenLabs can answer 200 with a not-yet-`done`
    // status and an empty transcript; only `done` replaces the live
    // transcript. A missing status (older payloads) keeps today's behaviour.
    if (typeof body.status === "string" && body.status !== "done") {
      logger.info(
        { conversationId, status: body.status },
        "provider record not ready; browser transcript will be used",
      );
      throw new VoiceCallRecordNotReadyError({ conversationId });
    }
    const startedAt = body.metadata?.start_time_unix_secs
      ? body.metadata.start_time_unix_secs * 1000
      : nowInstant().epochMilliseconds;
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
    const el = elevenLabsCredentialOf(credential);
    // No prompt/first-message overrides: passing them drops the agent's own
    // tool ids server-side (scenario#838). The key rides only into the SDK
    // adapter here — never onto the job payload's events or logs.
    const adapter = ScenarioRunner.voice.elevenLabsAgent({
      agentId,
      apiKey: el.apiKey,
    });
    // A single agent turn should never out-wait the whole-call budget the
    // child enforces; clamp the per-turn wait to it. The whole-call cut is the
    // child's timer, not a knob on the adapter.
    adapter.responseTimeout = Math.min(adapter.responseTimeout, maxCallSeconds);
    return wrapConnectRejection(adapter);
  },
};
