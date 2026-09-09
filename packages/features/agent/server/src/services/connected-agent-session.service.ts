/**
 * The session logic both transports share (ADR-128, "Transport"): the
 * credential check, the register frame, presence, call delivery, ack, result and
 * retirement.
 */

import {
  AgentCallForeignProjectError,
  AgentPayloadTooLargeError,
  AgentRegisterRefusedError,
  CALL_KEY_SLACK_SECONDS,
  PROTOCOL_VERSION,
  RESULT_TTL_SECONDS,
  type CallFrame,
  type RefusedCode,
  type RefusedFrame,
  type RegisterFrame,
  type RegisteredFrame,
  type ResultFrame,
  type AgentConnectCredentials,
  relayPayloadCaps,
} from "@langwatch/agent-contract";
import type { AgentService } from "./agent.service.ts";
import { createLogger } from "@langwatch/observability";
import { resultCapViolation } from "../rules/connected-agent-caps.rules.ts";
import {
  type InstanceGone,
  type ReplyNudge,
  type StoredCall,
  type StoredResult,
  storedCallSchema,
} from "@langwatch/agent-contract";
import {
  callAckKey,
  callKey,
  INSTANCE_GONE_CHANNEL,
  replyChannel,
  resultKey,
} from "../rules/connected-agent-keys.rules.ts";
import { ConnectedAgentRegistrationService } from "./connected-agent-registration.service.ts";
import { ConnectedAgentLastSeenService } from "./connected-agent-last-seen.service.ts";
import type { ConnectedAgentRuntime, InstanceMeta } from "./connected-agent-runtime.service.ts";
import { nowInstant } from "@langwatch/time";
import {
  type ConnectedAgentCredentials,
  type ResolvedConnectCredential,
} from "./connected-agent-credential.service.ts";

const logger = createLogger("langwatch:connected-agents:session");

/** The headers a transport authenticates with, however it carries them. */
/** One registered instance, as both transports see it. */
export interface SessionInfo {
  principalId: string;
  instanceId: string;
  projectId: string;
  projectSlug: string;
  agentIds: Set<string>;
  meta: InstanceMeta;
}

export interface SessionCoreOptions {
  runtime: ConnectedAgentRuntime;
  agents: AgentService;
  credentials: ConnectedAgentCredentials;
  publicBaseUrl: string;
  /** The app replicas of this deployment, for the no-Redis refusal. */
  replicaCount: number;
  /** `LANGWATCH_AGENT_RELAY_MAX_PAYLOAD_MB`; the default cap when absent. */
  relayMaxPayloadMb?: number;
  now?: () => number;
}

export class AgentSessionService {
  static create(options: SessionCoreOptions): AgentSessionService {
    return new AgentSessionService(options);
  }

  readonly runtime: ConnectedAgentRuntime;
  readonly #agents: AgentService;
  readonly #lastSeen: ConnectedAgentLastSeenService;
  readonly #credentials: ConnectedAgentCredentials;
  readonly #publicBaseUrl: string;
  readonly #replicaCount: number;
  readonly #relayMaxPayloadMb: number | undefined;
  readonly now: () => number;

  readonly #registrations: ConnectedAgentRegistrationService;

  private constructor(options: SessionCoreOptions) {
    this.runtime = options.runtime;
    this.#agents = options.agents;
    this.#lastSeen = ConnectedAgentLastSeenService.create(options.agents);
    this.#credentials = options.credentials;
    this.#publicBaseUrl = options.publicBaseUrl.replace(/\/+$/, "");
    this.#replicaCount = options.replicaCount;
    this.#relayMaxPayloadMb = options.relayMaxPayloadMb;
    this.now = options.now ?? (() => nowInstant().epochMilliseconds);
    this.#registrations = ConnectedAgentRegistrationService.create({
      runtime: this.runtime,
      agents: this.#agents,
      publicBaseUrl: this.#publicBaseUrl,
      now: this.now,
    });
  }

  /**
   * A deployment property, decided before any credential is read: with
   * several replicas and no Redis, a call on one pod could never reach an
   * instance held by another.
   */
  findReplicaRefusal(): AgentRegisterRefusedError | null {
    if (this.runtime.store.shared || this.#replicaCount <= 1) {
      return null;
    }

    return new AgentRegisterRefusedError({
      reason: "replica_count_unsupported",
      message: "Connected agents need Redis on a deployment with more than one app replica.",
    });
  }

  /** The project credential behind the request, or the refusal. */
  async authenticate({
    authorization,
    projectId,
  }: AgentConnectCredentials): Promise<ResolvedConnectCredential> {
    const header = authorization ?? "";
    const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
    if (!token) {
      throw new AgentRegisterRefusedError({
        reason: "api_key_invalid",
        message: "Send the API key as Authorization: Bearer <key>.",
      });
    }

    return this.#credentials.resolve({ token, projectId: projectId ?? null });
  }

  /** Upserts the rows of a register frame and records the instance as live. */
  async registerInstance(input: {
    frame: RegisterFrame;
    resolved: ResolvedConnectCredential;
    heartbeatIntervalMs: number;
  }): Promise<{ session: SessionInfo; registered: RegisteredFrame }> {
    return this.#registrations.registerInstance(input);
  }

  /** The refused frame for an error, and the refusal it stands for. */
  refusal(error: unknown): {
    frame: RefusedFrame;
    refused: AgentRegisterRefusedError;
  } {
    const refused =
      error instanceof AgentRegisterRefusedError
        ? error
        : new AgentRegisterRefusedError({
            reason: "api_key_invalid",
            message: "The connection could not be authenticated.",
          });
    if (!(error instanceof AgentRegisterRefusedError)) {
      logger.error({ error }, "connect refused by an unexpected error");
    }

    const { reason, ...meta } = refused.meta as {
      reason: RefusedCode;
    } & Record<string, unknown>;

    return {
      refused,
      frame: {
        type: "refused",
        protocol: PROTOCOL_VERSION,
        code: reason,
        message: refused.message,
        ...(Object.keys(meta).length > 0 && { meta }),
      },
    };
  }

  /**
   * The stored call an instance may work on, or null: the envelope is gone,
   * or it was routed at an instance that never registered its agent, in
   * which case the call is refused for that instance here and now.
   */
  async findCallForSession(session: SessionInfo, callId: string): Promise<StoredCall | null> {
    await this.runtime.ownership.claim(session);
    const raw = await this.runtime.store.tryGet(callKey(session.projectId, callId));
    if (!raw) {
      return null;
    }

    let stored: StoredCall;
    try {
      stored = storedCallSchema.parse(JSON.parse(raw));
    } catch {
      logger.warn({ callId }, "envelope could not be read, dropping the call");

      return null;
    }

    this.#assertOwnProject(session, stored);
    if (
      stored.instanceId !== session.instanceId ||
      !session.agentIds.has(stored.envelope.agentId)
    ) {
      // An instance only ever sees calls for the agents it registered itself.
      logger.warn(
        {
          callId,
          instanceId: session.instanceId,
          agentId: stored.envelope.agentId,
        },
        "call routed at an instance that did not register its agent, refusing it",
      );
      return null;
    }

    return stored;
  }

  /**
   * Records that a call frame never left the platform, so the dispatcher can
   * run the turn on another instance. The function cannot have started.
   */
  async undeliver(session: SessionInfo, callId: string): Promise<void> {
    const stored = await this.findCallForSession(session, callId);
    if (!stored) {
      return;
    }

    await this.#writeResult({
      stored,
      result: { instanceId: session.instanceId, undelivered: true },
    });
  }

  callFrame(stored: StoredCall): CallFrame {
    return { type: "call", protocol: PROTOCOL_VERSION, ...stored.envelope };
  }

  /** The instance started the function: the call can no longer be retried elsewhere. */
  async ack(session: SessionInfo, callId: string): Promise<void> {
    const stored = await this.findCallForSession(session, callId);
    if (!stored) {
      return;
    }

    await this.runtime.store.set(
      callAckKey(session.projectId, callId),
      "1",
      ttlOf(stored, this.now()),
    );
    await this.#nudgeReply(stored, { callId, kind: "ack" });
  }

  /** The instance answered: the result lands under its cap or as a payload error. */
  async result(session: SessionInfo, frame: ResultFrame): Promise<void> {
    const stored = await this.findCallForSession(session, frame.callId);
    if (!stored) {
      return;
    }

    const violation = resultCapViolation({
      output: frame.output,
      session: frame.session,
      caps: relayPayloadCaps(this.#relayMaxPayloadMb),
    });
    const result: StoredResult = violation
      ? tooLarge(session, violation)
      : {
          instanceId: session.instanceId,
          output: frame.output,
          session: frame.session,
          error: frame.error,
        };
    await this.#writeResult({ stored, result });
  }

  /** Keeps the instance live for every agent it serves. */
  async refreshPresence(session: SessionInfo): Promise<void> {
    await this.runtime.ownership.claim(session);
    await this.runtime.registry.refresh({
      projectId: session.projectId,
      instanceId: session.instanceId,
      agentIds: [...session.agentIds],
      now: this.now(),
      meta: session.meta,
    });
    for (const agentId of session.agentIds) {
      void this.#lastSeen.touch({
        projectId: session.projectId,
        agentId,
        now: this.now(),
      });
    }
  }

  /**
   * The instance is gone: retire its presence, fail the calls it held, and
   * tell every pod so the dispatcher fails them at once instead of at the
   * deadline.
   */
  async retire(session: SessionInfo, activeCallIds: Iterable<string>): Promise<void> {
    await this.runtime.ownership.claim(session);
    await this.runtime.registry.deregister({
      projectId: session.projectId,
      instanceId: session.instanceId,
      agentIds: [...session.agentIds],
      now: this.now(),
    });
    for (const callId of activeCallIds) {
      const stored = await this.findCallForSession(session, callId);
      if (!stored) {
        continue;
      }

      await this.#writeResult({
        stored,
        result: { instanceId: session.instanceId, disconnected: true },
      });
    }

    await this.runtime.store.publish(
      INSTANCE_GONE_CHANNEL,
      JSON.stringify({
        instanceId: session.instanceId,
        projectId: session.projectId,
      } satisfies InstanceGone),
    );
    logger.info(
      { projectId: session.projectId, instanceId: session.instanceId },
      "connected agent instance gone",
    );
  }

  /**
   * The instance id is chosen by the connecting process, so a session may
   * name an instance another project registered. A call is only ever the
   * session's own when the envelope carries the credential's project.
   */
  #assertOwnProject(session: SessionInfo, stored: StoredCall): void {
    if (stored.projectId === session.projectId) {
      return;
    }

    logger.warn(
      {
        callId: stored.envelope.callId,
        instanceId: session.instanceId,
        projectId: session.projectId,
      },
      "a session referred to a call of another project, refusing it",
    );

    throw new AgentCallForeignProjectError({ callId: stored.envelope.callId });
  }

  async #writeResult({
    stored,
    result,
  }: {
    stored: StoredCall;
    result: StoredResult;
  }): Promise<void> {
    await this.runtime.store.set(
      resultKey(stored.projectId, stored.envelope.callId),
      JSON.stringify(result),
      RESULT_TTL_SECONDS,
    );
    await this.#nudgeReply(stored, {
      callId: stored.envelope.callId,
      kind: "result",
    });
  }

  async #nudgeReply(stored: StoredCall, nudge: ReplyNudge): Promise<void> {
    await this.runtime.store.publish(replyChannel(stored.replyTo), JSON.stringify(nudge));
  }
}

function ttlOf(stored: StoredCall, now: number): number {
  return Math.max(1, Math.ceil((stored.envelope.deadlineAt - now) / 1000) + CALL_KEY_SLACK_SECONDS);
}

function tooLarge(
  session: SessionInfo,
  violation: {
    what: "result" | "session";
    sizeBytes: number;
    limitBytes: number;
  },
): StoredResult {
  const error = new AgentPayloadTooLargeError(violation);

  return {
    instanceId: session.instanceId,
    error: { code: error.code, message: error.message, payload: violation },
  };
}
