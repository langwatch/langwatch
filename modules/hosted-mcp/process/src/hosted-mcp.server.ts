import { defineServerModule } from "@langwatch/kernel";

import { HostedMcpApp } from "./app/hosted-mcp.app.ts";
import { mcpAuthorizeRest } from "./transport/mcp-authorize.rest.ts";
import { mcpEndpointDoor } from "./transport/mcp-endpoint.rest.ts";

export type { HostedMcpInfrastructure } from "./app/hosted-mcp.app.ts";

export const hostedMcpServer = defineServerModule("hosted-mcp")
  .withApp(HostedMcpApp)
  .withTransports(mcpAuthorizeRest, mcpEndpointDoor);
