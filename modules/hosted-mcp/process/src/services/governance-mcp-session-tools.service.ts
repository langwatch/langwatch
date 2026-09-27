import type { GovernanceRestApi } from "@langwatch/enterprise-governance-contract";

import { McpSessionToolRegistrar, type McpToolServer } from "../app/hosted-mcp.members.ts";

/** Installs governance's MCP tools on each session, through governance's own operation. */
export class GovernanceMcpSessionToolsService extends McpSessionToolRegistrar {
  private constructor(private readonly governance: Pick<GovernanceRestApi, "registerMcpTools">) {
    super();
  }

  static create({
    governance,
  }: {
    governance: Pick<GovernanceRestApi, "registerMcpTools">;
  }): GovernanceMcpSessionToolsService {
    return new GovernanceMcpSessionToolsService(governance);
  }

  register(input: {
    server: McpToolServer;
    apiKey: string;
    callerUserId: string | undefined;
  }): void {
    this.governance.registerMcpTools(input);
  }
}
