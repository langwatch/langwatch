/**
 * The session logic both transports share (ADR-128, "Transport"): the
 * credential check, the register frame, presence, call delivery, ack, result
 * and retirement. The WebSocket gateway and the HTTP long-poll transport own
 * their wire and their clocks; everything an instance means to the platform
 * is decided here, once.
 */

import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import { agentPlatformUrl } from "~/app/api/agents/agent-platform-url";
import type { PrismaClient } from "~/generated/prisma/client";
import { AgentService } from "~/server/agents/agent.service";
import { enforceApiKeyCeiling } from "~/server/api-key/auth-middleware";
import type { ResolvedToken } from "~/server/api-key/token-resolver";
import { TokenResolver } from "~/server/api-key/token-resolver";
import {
  type InstanceGone,
  type ReplyNudge,
  resultCapViolation,
  type StoredCall,
  type StoredResult,
  storedCallSchema,
} from "./call-envelope";
import {
  CALL_KEY_SLACK_SECONDS,
  DEFAULT_CALL_TIMEOUT_MS,
  DEFAULT_CONCURRENCY_DEVELOPMENT,
  DEFAULT_CONCURRENCY_SHARED,
  MAX_CALL_TIMEOUT_MS,
  RESULT_TTL_SECONDS,
  relayPayloadCaps,
} from "./constants";
import { AgentPayloadTooLargeError, AgentRegisterRefusedError } from "./errors";
import {
  DEVELOPMENT_ENVIRONMENT,
  deriveScope,
  identityKeyOf,
  isValidEnvironment,
  sanitizeEnvironment,
  scopeColumns,
} from "./identity";
import type { InstanceMeta } from "./instance.registry";
import {
  callAckKey,
  callKey,
  INSTANCE_GONE_CHANNEL,
  replyChannel,
  resultKey,
} from "./keys";
import { normalizeParameterSchema } from "./parameter-spec";
import { touchAgentLastSeen } from "./presence.projection";
import {
  type CallFrame,
  PROTOCOL_VERSION,
  type RefusedCode,
  type RefusedFrame,
  type RegisteredFrame,
  type RegisterFrame,
  type ResultFrame,
} from "./protocol";
import type { ConnectedAgentRuntime } from "./runtime";

const logger = createLogger("langwatch:connected-agents:session");

/** The headers a transport authenticates with, however it carries them. */
export interface ConnectCredentials {
  authorization: string | undefined;
  projectId: string | undefined;
}

/** One registered instance, as both transports see it. */
export interface SessionInfo {
  instanceId: string;
  projectId: string;
  projectSlug: string;
  agentIds: Set<string>;
  meta: InstanceMeta;
}

export interface SessionCoreOptions {
  runtime: ConnectedAgentRuntime;
  prisma: PrismaClient;
  /** The app replicas of this deployment, for the no-Redis refusal. */
  replicaCount: number;
  now?: () => number;
}

export class AgentSessionCore {
  readonly runtime: ConnectedAgentRuntime;
  private readonly prisma: PrismaClient;
  private readonly replicaCount: number;
  readonly now: () => number;

  constructor(options: SessionCoreOptions) {
    this.runtime = options.runtime;
    this.prisma = options.prisma;
    this.replicaCount = options.replicaCount;
    this.now = options.now ?? (() => Date.now());
  }

  /**
   * A deployment property, decided before any credential is read: with
   * several replicas and no Redis, a call on one pod could never reach an
   * instance held by another.
   */
  replicaRefusal(): AgentRegisterRefusedError | null {
    if (this.runtime.store.shared || this.replicaCount <= 1) return null;
    return new AgentRegisterRefusedError({
      reason: "replica_count_unsupported",
      message:
        "Connected agents need Redis on a deployment with more than one app replica.",
    });
  }

  /** The project credential behind the request, or the refusal. */
  async authenticate({
    authorization,
    projectId,
  }: ConnectCredentials): Promise<ResolvedToken> {
    const header = authorization ?? "";
    const token = header.toLowerCase().startsWith("bearer ")
      ? header.slice(7).trim()
      : "";
    if (!token) {
      throw new AgentRegisterRefusedError({
        reason: "api_key_invalid",
        message: "Send the API key as Authorization: Bearer <key>.",
      });
    }

    const resolver = TokenResolver.create(this.prisma);
    const resolved = await resolver.resolve({
      token,
      projectId: projectId ?? null,
    });
    if (!resolved) {
      throw await this.refusalForMiss({ resolver, token, projectId });
    }
    assertKeyKindMayConnect(resolved);
    await assertKeyMayManageScenarios(resolved);
    return resolved;
  }

  /**
   * A key that reaches several projects and named none is told which ones,
   * so the SDK can print them; everything else is an invalid key.
   */
  private async refusalForMiss({
    resolver,
    token,
    projectId,
  }: {
    resolver: TokenResolver;
    token: string;
    projectId: string | undefined;
  }): Promise<AgentRegisterRefusedError> {
    if (!projectId) {
      const org = await resolver.resolveOrgOnly({ token });
      if (org.ok) {
        const projects = await this.prisma.project.findMany({
          where: {
            team: { organizationId: org.resolved.organizationId },
            archivedAt: null,
          },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
          take: 50,
        });
        return new AgentRegisterRefusedError({
          reason: "project_required",
          message:
            "This API key reaches several projects. Send the project id in the X-Project-Id header.",
          meta: { projects },
        });
      }
    }
    return new AgentRegisterRefusedError({
      reason: "api_key_invalid",
      message: "The API key is not valid for this project.",
    });
  }

  /** Upserts the rows of a register frame and records the instance as live. */
  async registerInstance({
    frame,
    resolved,
    heartbeatIntervalMs,
  }: {
    frame: RegisterFrame;
    resolved: ResolvedToken;
    heartbeatIntervalMs: number;
  }): Promise<{ session: SessionInfo; registered: RegisteredFrame }> {
    const projectId = resolved.project.id;
    const userId = resolved.type === "apiKey" ? resolved.userId : null;
    const agents = await this.registerAgents({ frame, projectId, userId });

    const meta: InstanceMeta = {
      instanceId: frame.instance.id,
      projectId,
      hostname: frame.instance.hostname,
      username: frame.instance.username,
      pid: frame.instance.pid,
      sdk: frame.sdk,
      label: frame.instance.label ?? null,
      podId: this.runtime.podId,
      connectedAt: this.now(),
      maxConcurrency:
        frame.instance.maxConcurrency ??
        (agents.every((agent) => agent.environment === DEVELOPMENT_ENVIRONMENT)
          ? DEFAULT_CONCURRENCY_DEVELOPMENT
          : DEFAULT_CONCURRENCY_SHARED),
    };
    const session: SessionInfo = {
      instanceId: frame.instance.id,
      projectId,
      projectSlug: resolved.project.slug,
      agentIds: new Set(agents.map((agent) => agent.id)),
      meta,
    };
    await this.runtime.registry.register({
      meta,
      agentIds: [...session.agentIds],
      now: this.now(),
    });
    logger.info(
      {
        projectId,
        instanceId: session.instanceId,
        agentIds: [...session.agentIds],
        hostname: frame.instance.hostname,
      },
      "connected agent instance registered",
    );
    return {
      session,
      registered: {
        type: "registered",
        protocol: PROTOCOL_VERSION,
        agents: agents.map((agent) => ({
          name: agent.name,
          environment: agent.environment,
          id: agent.id,
          url: agentPlatformUrl({
            projectSlug: session.projectSlug,
            agentId: agent.id,
            agentType: "connected",
          }),
          parameterNotes: agent.notes,
        })),
        heartbeatIntervalMs,
        instanceId: session.instanceId,
      },
    };
  }

  /** Upserts every agent of the frame; refuses the frame on the first bad one. */
  private async registerAgents({
    frame,
    projectId,
    userId,
  }: {
    frame: RegisterFrame;
    projectId: string;
    userId: string | null;
  }): Promise<
    { id: string; name: string; environment: string; notes: string[] }[]
  > {
    const service = AgentService.create(this.prisma);
    const registered: {
      id: string;
      name: string;
      environment: string;
      notes: string[];
    }[] = [];
    for (const agent of frame.agents) {
      const environment = sanitizeEnvironment(agent.environment);
      if (!isValidEnvironment(environment)) {
        throw new AgentRegisterRefusedError({
          reason: "environment_invalid",
          message: `The environment "${agent.environment}" is not valid. Use letters, digits, dashes and underscores, up to 32 characters.`,
        });
      }
      let normalized: ReturnType<typeof normalizeParameterSchema>;
      try {
        normalized = normalizeParameterSchema(agent.parameters);
      } catch (error) {
        if (!HandledError.isHandled(error)) throw error;
        throw new AgentRegisterRefusedError({
          reason: "parameters_invalid",
          message: `${agent.name}: ${error.message}`,
          meta: { agentName: agent.name, ...error.meta },
        });
      }
      const scope = deriveScope({
        environment,
        userId,
        hostname: frame.instance.hostname,
      });
      const identityKey = identityKeyOf({
        name: agent.name,
        environment,
        scope,
      });
      const row = await service.registerConnected({
        id: `agent_${crypto.randomUUID().replace(/-/g, "").slice(0, 21)}`,
        projectId,
        name: agent.name,
        config: {
          parameters: normalized.parameters,
          timeoutMs: Math.min(
            agent.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS,
            MAX_CALL_TIMEOUT_MS,
          ),
          concurrency: agent.concurrency,
          sticky: agent.sticky,
          sdk: frame.sdk,
        },
        identity: { environment, identityKey, ...scopeColumns(scope) },
      });
      registered.push({
        id: row.id,
        name: row.name,
        environment,
        notes: normalized.notes,
      });
    }
    return registered;
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
  async readCallForSession(
    session: SessionInfo,
    callId: string,
  ): Promise<StoredCall | null> {
    const raw = await this.runtime.store.get(callKey(callId));
    if (!raw) return null;
    let stored: StoredCall;
    try {
      stored = storedCallSchema.parse(JSON.parse(raw));
    } catch {
      logger.warn({ callId }, "envelope could not be read, dropping the call");
      return null;
    }
    if (
      stored.instanceId !== session.instanceId ||
      stored.projectId !== session.projectId ||
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
      await this.writeResult({
        stored,
        result: { instanceId: session.instanceId, undelivered: true },
      });
      return null;
    }
    return stored;
  }

  /**
   * Records that a call frame never left the platform, so the dispatcher can
   * run the turn on another instance. The function cannot have started.
   */
  async undeliver(session: SessionInfo, callId: string): Promise<void> {
    const stored = await this.readStoredCall(callId);
    if (!stored || stored.instanceId !== session.instanceId) return;
    await this.writeResult({
      stored,
      result: { instanceId: session.instanceId, undelivered: true },
    });
  }

  callFrame(stored: StoredCall): CallFrame {
    return { type: "call", protocol: PROTOCOL_VERSION, ...stored.envelope };
  }

  /** The instance started the function: the call can no longer be retried elsewhere. */
  async ack(session: SessionInfo, callId: string): Promise<void> {
    const stored = await this.readStoredCall(callId);
    if (!stored || stored.instanceId !== session.instanceId) return;
    await this.runtime.store.set(
      callAckKey(callId),
      "1",
      ttlOf(stored, this.now()),
    );
    await this.nudgeReply(stored, { callId, kind: "ack" });
  }

  /** The instance answered: the result lands under its cap or as a payload error. */
  async result(session: SessionInfo, frame: ResultFrame): Promise<void> {
    const stored = await this.readStoredCall(frame.callId);
    if (!stored || stored.instanceId !== session.instanceId) return;
    const violation = resultCapViolation({
      output: frame.output,
      session: frame.session,
      caps: relayPayloadCaps(),
    });
    const result: StoredResult = violation
      ? tooLarge(session, violation)
      : {
          instanceId: session.instanceId,
          output: frame.output,
          session: frame.session,
          error: frame.error,
        };
    await this.writeResult({ stored, result });
  }

  /** Keeps the instance live for every agent it serves. */
  async refreshPresence(session: SessionInfo): Promise<void> {
    await this.runtime.registry.refresh({
      projectId: session.projectId,
      instanceId: session.instanceId,
      agentIds: [...session.agentIds],
      now: this.now(),
      meta: session.meta,
    });
    for (const agentId of session.agentIds) {
      void touchAgentLastSeen({
        prisma: this.prisma,
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
  async retire(
    session: SessionInfo,
    activeCallIds: Iterable<string>,
  ): Promise<void> {
    await this.runtime.registry.deregister({
      projectId: session.projectId,
      instanceId: session.instanceId,
      agentIds: [...session.agentIds],
      now: this.now(),
    });
    for (const callId of activeCallIds) {
      const stored = await this.readStoredCall(callId);
      if (!stored || stored.instanceId !== session.instanceId) continue;
      await this.writeResult({
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

  async readStoredCall(callId: string): Promise<StoredCall | null> {
    const raw = await this.runtime.store.get(callKey(callId));
    if (!raw) return null;
    try {
      return storedCallSchema.parse(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  private async writeResult({
    stored,
    result,
  }: {
    stored: StoredCall;
    result: StoredResult;
  }): Promise<void> {
    await this.runtime.store.set(
      resultKey(stored.envelope.callId),
      JSON.stringify(result),
      RESULT_TTL_SECONDS,
    );
    await this.nudgeReply(stored, {
      callId: stored.envelope.callId,
      kind: "result",
    });
  }

  private async nudgeReply(
    stored: StoredCall,
    nudge: ReplyNudge,
  ): Promise<void> {
    await this.runtime.store.publish(
      replyChannel(stored.replyTo),
      JSON.stringify(nudge),
    );
  }
}

/** An ingestion key or a Langy session key never connects an agent. */
function assertKeyKindMayConnect(resolved: ResolvedToken): void {
  if (resolved.type !== "apiKey") return;
  if (resolved.ingestSourceType || resolved.isLangySessionKey) {
    throw new AgentRegisterRefusedError({
      reason: "key_type_not_allowed",
      message:
        "An ingestion key or a Langy session key cannot connect an agent. Use a personal or a project API key.",
    });
  }
}

async function assertKeyMayManageScenarios(
  resolved: ResolvedToken,
): Promise<void> {
  try {
    await enforceApiKeyCeiling({ resolved, permission: "scenarios:manage" });
  } catch (error) {
    if (!HandledError.isHandled(error)) throw error;
    throw new AgentRegisterRefusedError({
      reason: "permission_denied",
      message:
        "The API key needs the scenarios:manage permission to connect an agent.",
    });
  }
}

function ttlOf(stored: StoredCall, now: number): number {
  return Math.max(
    1,
    Math.ceil((stored.envelope.deadlineAt - now) / 1000) +
      CALL_KEY_SLACK_SECONDS,
  );
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
