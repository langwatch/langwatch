import {
  HostedMcpApi,
  type HostedMcpApi as HostedMcpApiContract,
} from "@langwatch/hosted-mcp-contract";
import type { FeatureSetup } from "@langwatch/runtime-composition";
import { z } from "zod";
import { createMcpHandler, type McpHandler } from "../transport/hosted-mcp.api.ts";
import type { HostedMcpDependencies } from "./hosted-mcp-members.ts";

export type HostedMcpInfrastructure = Readonly<{
  mcp: Omit<HostedMcpDependencies, "baseHost">;
}>;

export type HostedMcpConfig = Readonly<{ baseHost: string }>;

type HostedMcpSetup = FeatureSetup<
  Readonly<Record<never, never>>,
  HostedMcpInfrastructure,
  HostedMcpConfig
>;

/** Owns the hosted MCP session transport's collaborators for one process. */
export class HostedMcpApp implements HostedMcpApiContract {
  static readonly contract = HostedMcpApi;
  static readonly dependencies = {} as const;
  static readonly configSchema = z.object({ baseHost: z.string().min(1) });

  #dependencies: HostedMcpDependencies;

  private constructor(dependencies: HostedMcpDependencies) {
    this.#dependencies = dependencies;
  }

  static create({ members, config }: HostedMcpSetup): HostedMcpApp {
    return new HostedMcpApp({ ...members.mcp, baseHost: config.baseHost });
  }

  createHandler(): McpHandler {
    return createMcpHandler(this.#dependencies);
  }
}
