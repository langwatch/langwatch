import { RawHttpProtocol } from "@langwatch/api";
import type { HostedMcpApiContract } from "@langwatch/hosted-mcp-contract";

import { MCP_METADATA_SUBTREES, MCP_ROOT_PATHS } from "../rules/mcp-routes.rules.ts";

/**
 * Main's hosted MCP root paths, answered over the raw Node request ahead of every route: the
 * SDK's Streamable HTTP and SSE transports write the response themselves (record §8).
 */
export const mcpEndpointDoor = RawHttpProtocol.create<HostedMcpApiContract>({
  paths: MCP_ROOT_PATHS,
  prefixes: MCP_METADATA_SUBTREES,
  open: (app) => {
    const endpoint = app.createHandler();
    return {
      handle: ({ request, response }) => endpoint.handleRequest(request, response),
      close: () => endpoint.closeAllSessions(),
    };
  },
});
