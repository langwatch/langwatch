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
import type { VoiceTransportRunner } from "../voice-transport.registry";

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

/** Reject `promise` if it has not settled within `timeoutMs`. */
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`connection timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Replace an adapter's `connect()` so a transport-level failure surfaces as the
 * run's error with the mandated prefix instead of a raw socket error, and can
 * never hang past `timeoutMs`. Exported so the exact message is unit-tested
 * against a throwing inner without a live socket.
 */
export function wrapConnectRejection<
  T extends { connect: () => Promise<void> },
>(adapter: T, timeoutMs: number = ELEVENLABS_CONNECT_TIMEOUT_MS): T {
  const original = adapter.connect.bind(adapter);
  adapter.connect = async () => {
    try {
      await withTimeout(original(), timeoutMs);
    } catch (error) {
      throw new Error(
        `${ELEVENLABS_CONNECT_REJECTED_PREFIX}: ${reasonOf(error)}`,
      );
    }
  };
  return adapter;
}

export const elevenLabsConvaiTransport: VoiceTransportRunner = {
  missingKeyMessage: NO_ELEVENLABS_KEY_MESSAGE,
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
