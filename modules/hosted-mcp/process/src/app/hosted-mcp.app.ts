import { AuthzApi } from "@langwatch/authz-contract";
import { HostedMcpApi, type HostedMcpApiContract } from "@langwatch/hosted-mcp-contract";
import type { FeatureSetup } from "@langwatch/kernel";
import { ProjectApi } from "@langwatch/project-contract";
import type { Cluster, Redis } from "ioredis";

import { AuthzMcpSessionGrantService } from "../services/authz-mcp-session-grant.service.ts";
import { HeaderMcpClientAddressService } from "../services/header-mcp-client-address.service.ts";
import { ProjectMcpProjectLookupService } from "../services/project-mcp-project-lookup.service.ts";
import { createMcpHandler, type McpHandler } from "../transport/hosted-mcp.api.ts";
import type { HostedMcpDependencies } from "./hosted-mcp-members.ts";

/**
 * Shapes restated rather than imported: a module depends on contracts.
 * `publicBaseUrl` is the process's own fact — this feature's entire former
 * config slice was `baseHost`, so it declares no config at all now.
 */
export type HostedMcpInfrastructure = Readonly<{
  /** The process's shared Redis connection, for OAuth codes and sessions (ADR-093). */
  redis: Redis | Cluster | null;
  /** The deployment's symmetric cipher, for the API key an OAuth session was minted from. */
  encryption: Readonly<{
    encrypt(plaintext: string): string;
    decrypt(ciphertext: string): string;
  }>;
  publicBaseUrl: string | undefined;
}>;

type HostedMcpDependenciesMap = Readonly<{
  /** Resolves the project an MCP bearer belongs to, without this module reading its tables. */
  projects: typeof ProjectApi;
  /** Re-checks the grant an OAuth bearer was minted from. */
  authorization: typeof AuthzApi;
}>;

type HostedMcpSetup = FeatureSetup<HostedMcpDependenciesMap, HostedMcpInfrastructure, undefined>;

/** Owns the hosted MCP session transport's collaborators for one process. */
export class HostedMcpApp implements HostedMcpApiContract {
  static readonly contract = HostedMcpApi;
  static readonly dependencies: HostedMcpDependenciesMap = {
    projects: ProjectApi,
    authorization: AuthzApi,
  };
  static readonly reads = ["redis", "encryption", "publicBaseUrl"] as const;

  #dependencies: HostedMcpDependencies;

  private constructor(dependencies: HostedMcpDependencies) {
    this.#dependencies = dependencies;
  }

  /** Refuses by name: a deployment naming no `BASE_HOST` cannot mount MCP. */
  static create({ members, dependencies }: HostedMcpSetup): HostedMcpApp {
    if (members.publicBaseUrl === undefined) {
      throw new Error(
        "The hosted MCP endpoint needs a public base URL, but this deployment named no BASE_HOST",
      );
    }

    return new HostedMcpApp({
      redis: members.redis,
      projects: ProjectMcpProjectLookupService.create({ projects: dependencies.projects }),
      grants: AuthzMcpSessionGrantService.create({ authorization: dependencies.authorization }),
      cipher: members.encryption,
      address: HeaderMcpClientAddressService.create(),
      baseHost: members.publicBaseUrl,
    });
  }

  createHandler(): McpHandler {
    return createMcpHandler(this.#dependencies);
  }
}
