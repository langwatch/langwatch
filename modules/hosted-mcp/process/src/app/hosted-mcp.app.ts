import { HostedMcpApi, type HostedMcpApiContract } from "@langwatch/hosted-mcp-contract";
import type { FeatureSetup } from "@langwatch/kernel";

import { createMcpHandler, type McpHandler } from "../transport/hosted-mcp.api.ts";
import type { HostedMcpDependencies } from "./hosted-mcp-members.ts";

/**
 * Shapes restated rather than imported: a module depends on contracts.
 * `publicBaseUrl` is the process's own fact — this feature's entire former
 * config slice was `baseHost`, so it declares no config at all now.
 */
export type HostedMcpInfrastructure = Readonly<{
  mcp: Omit<HostedMcpDependencies, "baseHost">;
  publicBaseUrl: string | undefined;
}>;

type HostedMcpSetup = FeatureSetup<
  Readonly<Record<never, never>>,
  HostedMcpInfrastructure,
  undefined
>;

/** Owns the hosted MCP session transport's collaborators for one process. */
export class HostedMcpApp implements HostedMcpApiContract {
  static readonly contract = HostedMcpApi;
  static readonly dependencies = {} as const;
  static readonly reads = ["mcp", "publicBaseUrl"] as const;

  #dependencies: HostedMcpDependencies;

  private constructor(dependencies: HostedMcpDependencies) {
    this.#dependencies = dependencies;
  }

  /** Refuses by name: a deployment naming no `BASE_HOST` cannot mount MCP. */
  static create({ members }: HostedMcpSetup): HostedMcpApp {
    if (members.publicBaseUrl === undefined) {
      throw new Error(
        "The hosted MCP endpoint needs a public base URL, but this deployment named no BASE_HOST",
      );
    }

    return new HostedMcpApp({ ...members.mcp, baseHost: members.publicBaseUrl });
  }

  createHandler(): McpHandler {
    return createMcpHandler(this.#dependencies);
  }
}
