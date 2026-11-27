// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { z } from "zod";

import type { GovernanceMcpServer } from "../../governance-mcp-tools.service.ts";

export type RegisteredTool = (args: Record<string, unknown>) => Promise<{
  content: { type: "text"; text: string }[];
}>;

/** An MCP server that keeps each registered tool by name, so a test can call it. */
export function recordingServer() {
  const tools = new Map<string, RegisteredTool>();
  const server: GovernanceMcpServer = {
    tool(name, _description, schema, cb) {
      tools.set(name, (args) => cb(z.object(schema).parse(args)));
      return undefined;
    },
  };
  return { server, tools };
}
