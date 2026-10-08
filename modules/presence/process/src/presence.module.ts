import type { PresenceApi } from "@langwatch/presence-contract";
import { defineProcessModule, type PublishedProcessModule } from "@langwatch/process";

import { PresenceModule } from "./app/presence.app.ts";
import { presenceRepositories } from "./repositories/presence-repositories.registry.ts";
import { presenceTrpcTransport } from "./transport/presence.trpc.ts";

export const presenceProcessModule: PublishedProcessModule<"presence", PresenceApi> =
  defineProcessModule("presence")
    .withRepositories(presenceRepositories)
    .withApi(PresenceModule)
    .withTransports(presenceTrpcTransport);
