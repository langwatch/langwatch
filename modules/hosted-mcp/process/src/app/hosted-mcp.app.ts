import { AuthApi } from "@langwatch/auth-contract";
import { AuthzApi } from "@langwatch/authz-contract";
import { GovernanceRestApi } from "@langwatch/enterprise-governance-contract";
import { HostedMcpApi, type HostedMcpApiContract } from "@langwatch/hosted-mcp-contract";
import type { FeatureSetup } from "@langwatch/kernel";
import { ProjectApi } from "@langwatch/project-contract";
import type { Cluster, Redis } from "ioredis";

import { mcpSessionRelayChannels } from "../channels/mcp-session-relay-channels.registry.ts";
import { RedisMcpOAuthClientRepository } from "../repositories/redis/redis.mcp-oauth-client.repository.ts";
import { RedisMcpOAuthTokenRepository } from "../repositories/redis/redis.mcp-oauth-token.repository.ts";
import { RedisMcpSessionRepository } from "../repositories/redis/redis.mcp-session.repository.ts";
import type { McpAuthorizeAnswer } from "../rules/mcp-authorize.rules.ts";
import { AuthzMcpSessionGrantService } from "../services/authz-mcp-session-grant.service.ts";
import { HeaderMcpClientAddressService } from "../services/header-mcp-client-address.service.ts";
import { McpAuthorizationService } from "../services/mcp-authorization.service.ts";
import { McpEndpointService, type McpHandler } from "../services/mcp-endpoint.service.ts";
import type { McpApiKeyCipher, McpCliSessions } from "../services/mcp-oauth-token.service.ts";
import { ProjectMcpProjectLookupService } from "../services/project-mcp-project-lookup.service.ts";
import type { McpAuthorizeApi } from "../transport/mcp-authorize.rest.ts";

/**
 * Shapes restated rather than imported: a module depends on contracts.
 * `publicBaseUrl` is the process's own fact — this feature's entire former
 * config slice was `baseHost`, so it declares no config at all now.
 */
export type HostedMcpInfrastructure = Readonly<{
  /** The process's shared Redis connection, for OAuth codes and sessions (ADR-093). */
  redis: Redis | Cluster | null;
  /** The deployment's symmetric cipher, for the credential an MCP session record holds. */
  encryption: Readonly<{
    encrypt(plaintext: string): string;
    decrypt(ciphertext: string): string;
  }>;
  publicBaseUrl: string | undefined;
}>;

/** Everything the hosted MCP endpoint needs from the process that mounts it. */
export type HostedMcpDependencies = Readonly<{
  /** The process's Redis connection, or nothing when it has none (ADR-093). */
  redis: Redis | Cluster | null;
  projects: Pick<ProjectMcpProjectLookupService, "resolveLiveProjectByApiKey">;
  /** Required, not optional: an unwired re-check is a token that never expires. */
  grants: Pick<AuthzMcpSessionGrantService, "stillGranted">;
  /** Mints, rotates and reads the person-bound, project-capped sessions an approval opens. */
  cliSessions: McpCliSessions;
  cipher: McpApiKeyCipher;
  address: Pick<HeaderMcpClientAddressService, "clientIp">;
  /** Absent installs no extra tools. */
  sessionTools?: Pick<GovernanceRestApi, "registerMcpTools"> | undefined;
  /** The public origin the MCP client is told to come back to. */
  baseHost: string;
}>;

type HostedMcpDependenciesMap = Readonly<{
  /** Resolves the project an MCP bearer belongs to, without this module reading its tables. */
  projects: typeof ProjectApi;
  /** Re-checks the grant an OAuth bearer was minted from. */
  authorization: typeof AuthzApi;
  /** Issues and reads the access and refresh tokens an MCP sign-in answers. */
  sessions: typeof AuthApi;
  /** Installs governance's tools on each session (Alex, 2026-09-27). */
  governance: typeof GovernanceRestApi;
}>;

type HostedMcpSetup = FeatureSetup<HostedMcpDependenciesMap, HostedMcpInfrastructure, undefined>;

/** Owns the hosted MCP session transport's collaborators for one process. */
export class HostedMcpApp implements HostedMcpApiContract, McpAuthorizeApi {
  static readonly contract = HostedMcpApi;
  static readonly dependencies: HostedMcpDependenciesMap = {
    projects: ProjectApi,
    authorization: AuthzApi,
    sessions: AuthApi,
    governance: GovernanceRestApi,
  };
  static readonly reads = ["redis", "encryption", "publicBaseUrl"] as const;

  #dependencies: HostedMcpDependencies;
  /** The consent page's approval step; absent where a suite composed the endpoint alone. */
  #authorization: McpAuthorizationService | undefined;

  private constructor(
    dependencies: HostedMcpDependencies,
    authorization: McpAuthorizationService | undefined,
  ) {
    this.#dependencies = dependencies;
    this.#authorization = authorization;
  }

  /** Refuses by name: a deployment naming no `BASE_HOST` cannot mount MCP. */
  static create({ members, dependencies }: HostedMcpSetup): HostedMcpApp {
    if (members.publicBaseUrl === undefined) {
      throw new Error(
        "The hosted MCP endpoint needs a public base URL, but this deployment named no BASE_HOST",
      );
    }

    const { projects, authorization } = dependencies;
    const approvals = McpAuthorizationService.create({
      collaborators: {
        findProject: async ({ projectId }) => {
          const project = await projects.findById(projectId);
          return (
            project && {
              id: project.id,
              organizationId: await projects.getOrganizationId(projectId),
              archivedAt: project.archivedAt,
            }
          );
        },
        mayApprove: ({ approver, projectId, permission }) =>
          authorization.hasPermission({ userId: approver.user.id, projectId, permission }),
        isDemoProject: (input) => authorization.isDemoProject(input),
        clients: RedisMcpOAuthClientRepository.create({ redis: members.redis }),
        codes: RedisMcpOAuthTokenRepository.create({ redis: members.redis }),
      },
    });

    return new HostedMcpApp(
      {
        redis: members.redis,
        projects: ProjectMcpProjectLookupService.create({ projects: dependencies.projects }),
        grants: AuthzMcpSessionGrantService.create({ authorization: dependencies.authorization }),
        cliSessions: dependencies.sessions,
        cipher: members.encryption,
        address: HeaderMcpClientAddressService.create(),
        baseHost: members.publicBaseUrl,
        sessionTools: dependencies.governance,
      },
      approvals,
    );
  }

  /** The app over collaborators already built, as a suite or another composition holds them. */
  static fromDependencies(dependencies: HostedMcpDependencies): HostedMcpApp {
    return new HostedMcpApp(dependencies, undefined);
  }

  /** `POST /api/mcp/authorize`, main's approval step of the hosted MCP OAuth flow. */
  authorize(input: { approverId: string | undefined; raw: string }): Promise<McpAuthorizeAnswer> {
    if (!this.#authorization) {
      throw new Error("This hosted MCP app was composed without its approval step");
    }
    return this.#authorization.authorize(input);
  }

  /** A fresh endpoint, with its own sessions, caches and reaper, over this process's stores. */
  createHandler(): McpHandler {
    const { redis, ...collaborators } = this.#dependencies;
    return McpEndpointService.create({
      ...collaborators,
      sessionRecords: RedisMcpSessionRepository.create({ redis }),
      relay: mcpSessionRelayChannels.live.create({ redis }),
      oauthTokenRecords: RedisMcpOAuthTokenRepository.create({ redis }),
      oauthClients: RedisMcpOAuthClientRepository.create({ redis }),
    });
  }
}
