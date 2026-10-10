import { defineProcessModule, type PublishedProcessModule } from "@langwatch/process";
import type { ShareApi } from "@langwatch/share-contract";

import { ShareModule } from "./app/share.app.ts";
import { shareTraceSharingRevocationEventing } from "./eventing/share-trace-sharing-revocation.pipeline.ts";
import { shareRepositories } from "./repositories/share-repositories.registry.ts";
import { pinnedTraceTrpcTransport } from "./transport/pinned-trace.trpc.ts";
import { shareTrpcTransport } from "./transport/share.trpc.ts";

export const shareProcessModule: PublishedProcessModule<"share", ShareApi> = defineProcessModule(
  "share",
)
  .withRepositories(shareRepositories)
  .withApi(ShareModule)
  .withTransports(shareTrpcTransport, pinnedTraceTrpcTransport)
  .withEventing(shareTraceSharingRevocationEventing);
