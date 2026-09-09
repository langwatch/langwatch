import { defineFeature } from "@langwatch/runtime-composition";
import { ShareApp } from "./app/share.app.ts";
import { shareRepositories } from "./repositories/share-repositories.registry.ts";
import { pinnedTraceTrpcTransport } from "./transport/pinned-trace.trpc.ts";
import { shareTrpcTransport } from "./transport/share.trpc.ts";

export const shareServer = defineFeature("share")
  .withRepositories(shareRepositories)
  .withApp(ShareApp)
  .withTransports(shareTrpcTransport, pinnedTraceTrpcTransport)
  .build();
