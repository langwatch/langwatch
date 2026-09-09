import { defineModule } from "@langwatch/runtime-composition";
import { GatewayApp } from "./app/gateway.app.ts";

export type { GatewayInfrastructure } from "./app/gateway.app.ts";

export const gatewayServer = defineModule("gateway").withApp(GatewayApp).build();
