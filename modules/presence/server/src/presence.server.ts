import { defineServerModule } from "@langwatch/runtime-composition";
import { PresenceApp } from "./app/presence.app.ts";
import { presenceRepositories } from "./repositories/presence-repositories.registry.ts";
import { presenceTrpcTransport } from "./transport/presence.trpc.ts";

export const presenceServer = defineServerModule("presence")
  .withRepositories(presenceRepositories)
  .withApp(PresenceApp)
  .withTransports(presenceTrpcTransport)
  .build();
