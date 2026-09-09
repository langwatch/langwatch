import { defineFeature } from "@langwatch/runtime-composition";
import { HostedMcpApp } from "./app/hosted-mcp.app.ts";

export type { HostedMcpConfig, HostedMcpInfrastructure } from "./app/hosted-mcp.app.ts";

export const hostedMcpServer = defineFeature("hosted-mcp").withApp(HostedMcpApp).build();
