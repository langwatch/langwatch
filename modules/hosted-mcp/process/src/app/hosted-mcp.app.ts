import { AuthApi } from "@langwatch/auth-contract";
import { AuthzApi } from "@langwatch/authz-contract";
import { GovernanceRestApi } from "@langwatch/enterprise-governance-contract";
import {
  HostedMcpApi,
  type HostedMcpApiContract,
  hostedMcpConfig,
  type HostedMcpServerConfig,
} from "@langwatch/hosted-mcp-contract";
import type { FeatureSetup } from "@langwatch/process";
import { ProjectApi } from "@langwatch/project-contract";

import type { HostedMcpRepositories } from "../repositories/hosted-mcp.repositories.ts";
import type { McpAuthorizeAnswer } from "../rules/mcp-authorize.rules.ts";
import { AuthzMcpSessionGrantService } from "../services/authz-mcp-session-grant.service.ts";
import { HeaderMcpClientAddressService } from "../services/header-mcp-client-address.service.ts";
import { McpAuthorizationService } from "../services/mcp-authorization.service.ts";
import { McpEndpointService, type McpHandler } from "../services/mcp-endpoint.service.ts";
import type { McpCliSessions } from "../services/mcp-oauth-token.service.ts";
import { ProjectMcpProjectLookupService } from "../services/project-mcp-project-lookup.service.ts";
import type { McpAuthorizeApi } from "../transport/mcp-authorize.rest.ts";

/** Everything the hosted MCP endpoint needs from the process that mounts it. */
export type HostedMcpDependencies = Readonly<{
  /** Session records, the replica relay, OAuth codes and clients, from one tier. */
  repositories: HostedMcpRepositories;
  projects: Pick<ProjectMcpProjectLookupService, "resolveLiveProjectByApiKey">;
  /** Required, not optional: an unwired re-check is a token that never expires. */
  grants: Pick<AuthzMcpSessionGrantService, "stillGranted">;
  /** Mints, rotates and reads the person-bound, project-capped sessions an approval opens. */
  cliSessions: McpCliSessions;
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

type HostedMcpSetup = FeatureSetup<
  HostedMcpDependenciesMap,
  never,
  HostedMcpServerConfig,
  HostedMcpRepositories
>;

/** Owns the hosted MCP session transport's collaborators for one process. */
export class HostedMcpModule implements HostedMcpApiContract, McpAuthorizeApi {
  static readonly contract = HostedMcpApi;
  static readonly dependencies: HostedMcpDependenciesMap = {
    projects: ProjectApi,
    authorization: AuthzApi,
    sessions: AuthApi,
    governance: GovernanceRestApi,
  };
  static readonly config = hostedMcpConfig;

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
  static create({ dependencies, config, repositories }: HostedMcpSetup): HostedMcpModule {
    if (config.publicBaseUrl === undefined) {
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
        clients: repositories.oauthClients,
        codes: repositories.oauthTokens,
      },
    });

    return new HostedMcpModule(
      {
        repositories,
        projects: ProjectMcpProjectLookupService.create({ projects: dependencies.projects }),
        grants: AuthzMcpSessionGrantService.create({ authorization: dependencies.authorization }),
        cliSessions: dependencies.sessions,
        address: HeaderMcpClientAddressService.create(),
        baseHost: config.publicBaseUrl,
        sessionTools: dependencies.governance,
      },
      approvals,
    );
  }

  /** The app over collaborators already built, as a suite or another composition holds them. */
  static fromDependencies(dependencies: HostedMcpDependencies): HostedMcpModule {
    return new HostedMcpModule(dependencies, undefined);
  }

  /** `POST /api/mcp/authorize`, main's approval step of the hosted MCP OAuth flow. */
  authorize(input: { approverId: string | undefined; raw: string }): Promise<McpAuthorizeAnswer> {
    if (!this.#authorization) {
      throw new Error("This hosted MCP app was composed without its approval step");
    }
    return this.#authorization.authorize(input);
  }

  /** A fresh endpoint, with its own sessions, caches and reaper, over this app's repositories. */
  createHandler(): McpHandler {
    const { repositories, ...collaborators } = this.#dependencies;
    return McpEndpointService.create({
      ...collaborators,
      sessionRecords: repositories.sessions,
      relay: repositories.relay,
      oauthTokenRecords: repositories.oauthTokens,
      oauthClients: repositories.oauthClients,
    });
  }
}
