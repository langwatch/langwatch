import type { HostedMcpApiContract, HostedMcpServerConfig } from "@langwatch/hosted-mcp-contract";
import { defineProcessModule, type PublishedProcessModule } from "@langwatch/process";

import { HostedMcpModule } from "./app/hosted-mcp.app.ts";
import { hostedMcpRepositories } from "./repositories/hosted-mcp-repositories.registry.ts";
import { mcpAuthorizeRest } from "./transport/mcp-authorize.rest.ts";
import { mcpEndpointDoor } from "./transport/mcp-endpoint.rest.ts";

export const hostedMcpProcessModule: PublishedProcessModule<
  "hosted-mcp",
  HostedMcpApiContract,
  HostedMcpServerConfig
> = defineProcessModule("hosted-mcp")
  .withRepositories(hostedMcpRepositories)
  .withApi(HostedMcpModule)
  .withTransports(mcpAuthorizeRest, mcpEndpointDoor);
