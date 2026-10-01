import { defineProcessModule } from "@langwatch/process";

import { HostedMcpModule } from "./app/hosted-mcp.app.ts";
import { mcpAuthorizeRest } from "./transport/mcp-authorize.rest.ts";
import { mcpEndpointDoor } from "./transport/mcp-endpoint.rest.ts";

export type { HostedMcpInfrastructure } from "./app/hosted-mcp.app.ts";

export const hostedMcpProcessModule = defineProcessModule("hosted-mcp")
  .withApi(HostedMcpModule)
  .withTransports(mcpAuthorizeRest, mcpEndpointDoor);
