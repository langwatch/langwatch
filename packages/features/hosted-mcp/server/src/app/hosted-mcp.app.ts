import {
  HostedMcpApi,
  type HostedMcpApi as HostedMcpApiContract,
} from "@langwatch/hosted-mcp-contract";
import type { FeatureSetup } from "@langwatch/runtime-composition";
import type { AppRestSecurity } from "@langwatch/api/rest";
import { z } from "zod";
import { createMcpAuthorizeRestApp } from "../transport/api-rest/mcp-authorize.api.ts";
import { createMcpHandler, type McpHandler } from "../transport/api-mcp/hosted-mcp.api.ts";
import type { HostedMcpDependencies } from "../ports/hosted-mcp.port.ts";
import type { McpAuthorizeRestPorts } from "../transport/api-rest/mcp-authorize.api.ts";

export type HostedMcpInfrastructure = Readonly<{
  mcp: Omit<HostedMcpDependencies, "baseHost">;
  security: AppRestSecurity;
  authorize: Omit<McpAuthorizeRestPorts, "redis">;
}>;

export type HostedMcpConfig = Readonly<{ baseHost: string }>;

type HostedMcpSetup = FeatureSetup<
  Readonly<Record<never, never>>,
  HostedMcpInfrastructure,
  HostedMcpConfig
>;

/** Owns the hosted MCP session and OAuth transport collaborators for one process. */
export class HostedMcpApp implements HostedMcpApiContract {
  static readonly contract = HostedMcpApi;
  static readonly dependencies = {} as const;
  static readonly configSchema = z.object({ baseHost: z.string().min(1) });

  #dependencies: HostedMcpDependencies;
  #security: AppRestSecurity;
  #authorize: Omit<McpAuthorizeRestPorts, "redis">;

  private constructor(
    dependencies: HostedMcpDependencies,
    security: AppRestSecurity,
    authorize: Omit<McpAuthorizeRestPorts, "redis">,
  ) {
    this.#dependencies = dependencies;
    this.#security = security;
    this.#authorize = authorize;
  }

  static create({ infrastructure, config }: HostedMcpSetup): HostedMcpApp {
    return new HostedMcpApp(
      { ...infrastructure.mcp, baseHost: config.baseHost },
      infrastructure.security,
      infrastructure.authorize,
    );
  }

  createHandler(): McpHandler {
    return createMcpHandler(this.#dependencies);
  }

  createAuthorizeRestApp() {
    return createMcpAuthorizeRestApp({
      security: this.#security,
      ports: { ...this.#authorize, redis: this.#dependencies.redis },
    });
  }
}
