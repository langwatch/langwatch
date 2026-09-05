/**
 * Registering a connected-agent process: upserting the agent rows its frame declares, and
 * recording the instance as live.
 */

import {
  AgentRegisterRefusedError,
  type AgentService,
  DEFAULT_CALL_TIMEOUT_MS,
  DEFAULT_CONCURRENCY,
  MAX_CALL_TIMEOUT_MS,
  PROTOCOL_VERSION,
  type RegisterFrame,
  type RegisteredFrame,
  deriveScope,
  identityKeyOf,
  isValidEnvironment,
  sanitizeEnvironment,
  scopeColumns,
} from "@langwatch/agent-contract";
import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import type { AgentPlatformUrlBuilder } from "../transport/api-rest/agent-legacy.api";
import { ConnectedAgentParameterSpecService } from "./connected-agent-parameter-spec.service";
import type { ConnectedAgentRuntime, InstanceMeta } from "../ports/connected-agent-runtime.port";
import type { ResolvedConnectCredential } from "../ports/connect-credential.port";
import type { SessionInfo } from "./connected-agent-session.service";

const logger = createLogger("langwatch:connected-agents:registration");

type ConnectedAgentRegistrationOptions = {
  runtime: ConnectedAgentRuntime;
  agents: AgentService;
  agentPlatformUrl: AgentPlatformUrlBuilder;
  now: () => number;
};

export class ConnectedAgentRegistrationService {
  static create(options: ConnectedAgentRegistrationOptions): ConnectedAgentRegistrationService {
    return new ConnectedAgentRegistrationService(options);
  }

  private readonly runtime: ConnectedAgentRuntime;
  private readonly agents: AgentService;
  private readonly agentPlatformUrl: AgentPlatformUrlBuilder;
  private readonly now: () => number;

  private constructor(options: ConnectedAgentRegistrationOptions) {
    this.runtime = options.runtime;
    this.agents = options.agents;
    this.agentPlatformUrl = options.agentPlatformUrl;
    this.now = options.now;
  }

  /** Upserts the rows of a register frame and records the instance as live. */
  async registerInstance({
    frame,
    resolved,
    heartbeatIntervalMs,
  }: {
    frame: RegisterFrame;
    resolved: ResolvedConnectCredential;
    heartbeatIntervalMs: number;
  }): Promise<{ session: SessionInfo; registered: RegisteredFrame }> {
    const projectId = resolved.project.id;
    const userId = resolved.userId;
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
      maxConcurrency: frame.instance.maxConcurrency ?? DEFAULT_CONCURRENCY,
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
          url: this.agentPlatformUrl({
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
  }): Promise<{ id: string; name: string; environment: string; notes: string[] }[]> {
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

      let normalized: ReturnType<
        typeof ConnectedAgentParameterSpecService.normalizeParameterSchema
      >;
      try {
        normalized = ConnectedAgentParameterSpecService.normalizeParameterSchema(agent.parameters);
      } catch (error) {
        if (!HandledError.isHandled(error)) {
          throw error;
        }

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
      const row = await this.agents.registerConnected({
        id: `agent_${crypto.randomUUID().replace(/-/g, "").slice(0, 21)}`,
        projectId,
        name: agent.name,
        config: {
          parameters: normalized.parameters,
          timeoutMs: Math.min(agent.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS, MAX_CALL_TIMEOUT_MS),
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
}
