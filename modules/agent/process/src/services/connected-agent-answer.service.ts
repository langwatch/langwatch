import {
  AgentBusyError,
  AgentCallFailedError,
  AgentPayloadTooLargeError,
  BUSY_RETRY_AFTER_MS,
  type CallEnvelope,
  type CallOutcome,
  STICKY_PIN_TTL_SECONDS,
  type StoredResultError,
  storedResultSchema,
} from "@langwatch/agent-contract";
import type { SessionStateStore } from "@langwatch/redis-client/session-state";

import { resultKey, threadPinKey } from "../rules/connected-agent-keys.rules.ts";
import { type LiveInstance } from "./connected-agent-runtime.service.ts";

type AnswerOptions = { store: SessionStateStore };

/** Reads a delivered call result and holds sticky threads on their instance. */
export class ConnectedAgentAnswerService {
  readonly #store: SessionStateStore;

  static create(options: AnswerOptions): ConnectedAgentAnswerService {
    return new ConnectedAgentAnswerService(options);
  }

  private constructor(options: AnswerOptions) {
    this.#store = options.store;
  }

  /** Reads a delivered result as the answer, a retry or a disconnect. */
  async read({
    projectId,
    instance,
    envelope,
    isSticky,
  }: {
    projectId: string;
    instance: LiveInstance;
    envelope: CallEnvelope;
    isSticky: boolean;
  }): Promise<
    | { kind: "answered"; answer: Omit<CallOutcome, "durationMs"> }
    | { kind: "retry" }
    | { kind: "disconnected" }
  > {
    const { callId } = envelope;
    const result = await this.#readResult({ projectId, callId });
    if (result?.undelivered) {
      // The frame never left the platform, so the function did not start.
      return { kind: "retry" };
    }
    if (!result || result.disconnected) {
      // The socket carried the call and then closed with no answer. The
      // function may have run, so the turn is not placed on another
      // instance.
      return { kind: "disconnected" };
    }
    if (result.error) {
      throw remoteError(result.error);
    }
    await this.pinThread({
      isSticky,
      pinKey: threadPinKey(projectId, envelope.agentId, envelope.threadId),
      instanceId: instance.instanceId,
    });
    return {
      kind: "answered",
      answer: {
        output: result.output ?? "",
        session: result.session,
        instance: {
          instanceId: instance.instanceId,
          hostname: instance.hostname,
          label: instance.label,
        },
      },
    };
  }

  /** Whether the stored result says the frame never left the platform. */
  async isUndelivered({
    projectId,
    callId,
  }: {
    projectId: string;
    callId: string;
  }): Promise<boolean> {
    const result = await this.#readResult({ projectId, callId });
    return Boolean(result?.undelivered);
  }

  /** Holds a sticky thread on the instance that answers it. */
  async pinThread({
    isSticky,
    pinKey,
    instanceId,
  }: {
    isSticky: boolean;
    pinKey: string;
    instanceId: string;
  }): Promise<void> {
    if (!isSticky) return;
    await this.#store.set(pinKey, instanceId, STICKY_PIN_TTL_SECONDS);
  }

  async #readResult({ projectId, callId }: { projectId: string; callId: string }) {
    const raw = await this.#store.tryGet(resultKey(projectId, callId));
    return raw ? findParsedFrame(storedResultSchema, raw) : null;
  }
}

/**
 * The error a result carries, as the handled error the caller reads.
 */
function remoteError(error: StoredResultError): Error {
  if (error.payload) {
    return new AgentPayloadTooLargeError(error.payload);
  }
  if (error.code === "agent_busy") {
    return new AgentBusyError({ retryAfterMs: BUSY_RETRY_AFTER_MS });
  }
  return new AgentCallFailedError({
    remoteCode: error.code,
    remoteMessage: error.message,
  });
}

function findParsedFrame<T>(
  schema: { safeParse: (raw: unknown) => { success: boolean; data?: T } },
  raw: string,
): T | null {
  try {
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? (parsed.data as T) : null;
  } catch {
    return null;
  }
}
