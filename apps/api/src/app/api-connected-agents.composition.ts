/**
 * The connected-agent transport (ADR-128): the WebSocket gateway, the HTTP long-poll
 * fallback, and the credential and runnable-target checks both ride on.
 */
import type { AgentService } from "@langwatch/agent-contract";
import {
  ConnectedAgentRuntimeAdapter,
  ConnectGateway,
  LongPollTransportService,
  PostgresAgentAdapter,
  type AssertConnectedAgentsRunnablePort,
  type ConnectedAgentRuntime,
  type ConnectUpgradeRouterPort,
} from "@langwatch/agent-server";
import type { ApiKeyService } from "@langwatch/api-key-contract";
import { runActorFromRequest } from "@langwatch/scenario-contract";
import { ConnectedTargetService } from "@langwatch/suite-server";
import type { PrismaConnection } from "@langwatch/prisma-client";
import type { RedisConnection } from "@langwatch/redis-client";

import { createAgentPlatformUrlBuilder } from "../features/agent/agent-platform-url";
import { ApiConnectCredentialAdapter } from "../features/agent/agent-connect-credential.adapter";
import type { ApiHandlerManagedCredentials } from "./api-handler-managed-credential";

/** Reports the composition decisions a missing collaborator would otherwise hide. */
export abstract class ApiConnectedAgentsAbsenceReportPort {
  /** A multi-replica deployment with no Redis: every connect refuses `replica_count_unsupported`. */
  abstract withoutSharedStore(replicaCount: number): void;
  /** No database: an instance has nowhere to register, so the transport does not mount. */
  abstract withoutDatabase(): void;
}

export type ApiConnectedAgentsCompositionOptions = {
  database: PrismaConnection | undefined;
  /** This process's own queue Redis, shared with `installConnectedAgentRedis`. */
  redis: RedisConnection | null;
  agents: AgentService;
  apiKeys: ApiKeyService;
  credentials: ApiHandlerManagedCredentials;
  /** Named for the `project_required` refusal's `meta.projects`. */
  projectsReachableBy: (organizationId: string) => Promise<{ id: string; name: string }[]>;
  publicBaseUrl: string | undefined;
  replicaCount: number;
  relayMaxPayloadMb?: number;
  processName: string;
  report?: ApiConnectedAgentsAbsenceReportPort;
};

/**
 * The API process's own connected-agent transport, composed rather than received.
 */
export class ApiConnectedAgentsComposition {
  static tryCompose(
    options: ApiConnectedAgentsCompositionOptions,
  ): ApiConnectedAgentsComposition | undefined {
    if (!options.database) {
      options.report?.withoutDatabase();
      return undefined;
    }
    if (options.redis) {
      ConnectedAgentRuntimeAdapter.install(options.redis);
    } else if (options.replicaCount > 1) {
      options.report?.withoutSharedStore(options.replicaCount);
    }
    const runtime = ConnectedAgentRuntimeAdapter.get();
    // Only for the register frame's per-agent deep link; the REST family's
    // OWN response link rides the shared `ports.agentPlatformUrl` a packaged
    // family already takes — this is a second, pure builder, not a second
    // source of truth for the URL shape.
    const agentPlatformUrl = createAgentPlatformUrlBuilder(
      createDeepLinkUrl(options.publicBaseUrl),
    );
    const presenceWriter = PostgresAgentAdapter.create({
      database: options.database.client,
      processName: options.processName,
    }).presenceWriter();
    const credentials = ApiConnectCredentialAdapter.create({
      apiKeys: options.apiKeys,
      credentials: options.credentials,
      projectsReachableBy: options.projectsReachableBy,
    });
    const sessionOptions = {
      runtime,
      agents: options.agents,
      agentRepository: presenceWriter,
      credentials,
      agentPlatformUrl,
      replicaCount: options.replicaCount,
      ...(options.relayMaxPayloadMb !== undefined
        ? { relayMaxPayloadMb: options.relayMaxPayloadMb }
        : {}),
    };
    const gateway = new ConnectGateway(sessionOptions);
    const longPoll = LongPollTransportService.create(sessionOptions);
    const assertRunnable: AssertConnectedAgentsRunnablePort = ({ agent, apiKeyUserId }) =>
      ConnectedTargetService.assertConnectedAgentsRunnable({
        agents: [
          {
            id: agent.id,
            name: agent.name,
            type: agent.type,
            ownerUserId: agent.ownerUserId ?? null,
          },
        ],
        actor: runActorFromRequest({ userId: apiKeyUserId, surfaceHeader: undefined }),
        owners: ConnectedTargetService.agentOwnerNameReader(options.agents),
      });
    return new ApiConnectedAgentsComposition(
      runtime,
      gateway,
      longPoll,
      credentials,
      assertRunnable,
      options.relayMaxPayloadMb,
    );
  }

  private constructor(
    readonly runtime: ConnectedAgentRuntime,
    readonly gateway: ConnectGateway,
    readonly longPoll: LongPollTransportService,
    readonly credentials: ApiConnectCredentialAdapter,
    readonly assertRunnable: AssertConnectedAgentsRunnablePort,
    readonly relayMaxPayloadMb: number | undefined,
  ) {}

  /** Mounts the WebSocket upgrade path on the process's shared router. */
  mount(router: ConnectUpgradeRouterPort): void {
    this.gateway.mount(router);
  }

  /** Closes the socket, the long-poll transport, then the runtime, in that order. */
  async close(): Promise<void> {
    let firstError: unknown;
    for (const closeOne of [
      () => this.gateway.close(),
      () => this.longPoll.close(),
      () => ConnectedAgentRuntimeAdapter.close(),
    ]) {
      try {
        await closeOne();
      } catch (error) {
        firstError ??= error;
      }
    }
    if (firstError) throw firstError;
  }
}

function createDeepLinkUrl(publicBaseUrl: string | undefined) {
  const base = (publicBaseUrl ?? "").replace(/\/+$/, "");
  return ({ projectSlug, path }: { projectSlug: string; path: string }) => {
    const cleanPath = path.startsWith("/") ? path : `/${path}`;
    return `${base}/${projectSlug}${cleanPath}`;
  };
}
