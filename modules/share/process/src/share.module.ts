import { defineProcessModule } from "@langwatch/process";

import { ShareModule } from "./app/share.app.ts";
import { shareRepositories } from "./repositories/share-repositories.registry.ts";
import { pinnedTraceTrpcTransport } from "./transport/pinned-trace.trpc.ts";
import { shareTrpcTransport } from "./transport/share.trpc.ts";

export const shareProcessModule = defineProcessModule("share")
  .withRepositories(shareRepositories)
  .withApi(ShareModule)
  .withTransports(shareTrpcTransport, pinnedTraceTrpcTransport);
