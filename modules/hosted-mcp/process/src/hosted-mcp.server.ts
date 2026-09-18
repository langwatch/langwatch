import { defineServerModule } from "@langwatch/kernel";
import { HostedMcpApp } from "./app/hosted-mcp.app.ts";

export type { HostedMcpConfig, HostedMcpInfrastructure } from "./app/hosted-mcp.app.ts";

export const hostedMcpServer = defineServerModule("hosted-mcp").withApp(HostedMcpApp).build();
