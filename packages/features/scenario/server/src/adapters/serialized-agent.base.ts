/**
 * The base of every serialized adapter: what a target keeps between the turns of one conversation.
 * for that conversation (ADR-128). The platform holds it here, per thread,
 */

import { AgentAdapter } from "@langwatch/scenario";
import { SESSION_MAX_BYTES } from "@langwatch/agent-contract";

/** The marker the failure classifier reads a refused session by. */
export const SESSION_TOO_LARGE_PREFIX = "Agent session too large";

/** The handled error code a refused session is reported under. */
export const SESSION_TOO_LARGE_CODE = "agent_payload_too_large";

/**
 * The agent answered with a session above the cap. The message carries the
 * code the relay route would answer with, so the run's failure envelope and a
 * REST caller read one vocabulary.
 */
export class AgentSessionTooLargeError extends Error {
  readonly code = SESSION_TOO_LARGE_CODE;
  readonly sizeBytes: number;
  readonly limitBytes: number;

  constructor({ sizeBytes, limitBytes }: { sizeBytes: number; limitBytes: number }) {
    super(
      `${SESSION_TOO_LARGE_PREFIX} (${SESSION_TOO_LARGE_CODE}): the agent returned a session of ${sizeBytes} bytes, above the limit of ${limitBytes} bytes.`,
    );
    this.name = "AgentSessionTooLargeError";
    this.sizeBytes = sizeBytes;
    this.limitBytes = limitBytes;
  }
}

/** The size of a JSON value on the wire, in bytes. */
function jsonByteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value ?? null), "utf8");
}

export abstract class SerializedAgentAdapter extends AgentAdapter {
  private readonly sessions = new Map<string, unknown>();

  /** The session the agent last returned for a thread, or nothing yet. */
  protected sessionOf(threadId: string): unknown {
    return this.sessions.get(threadId);
  }

  /**
   * Keep what the agent returned for the thread. An absent value (`undefined`) is a turn that said
   * nothing about the session, and leaves the held value as it was; `null` is a value the agent
   * chose and is kept as such. @throws AgentSessionTooLargeError when the value is above the cap.
   */
  protected storeSession({ threadId, session }: { threadId: string; session: unknown }): void {
    if (session === undefined) return;
    const sizeBytes = jsonByteLength(session);
    if (sizeBytes > SESSION_MAX_BYTES) {
      throw new AgentSessionTooLargeError({
        sizeBytes,
        limitBytes: SESSION_MAX_BYTES,
      });
    }
    this.sessions.set(threadId, session);
  }
}
