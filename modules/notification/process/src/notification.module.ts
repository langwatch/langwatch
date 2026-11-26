import type {
  NotificationService,
  NotificationServerConfig,
} from "@langwatch/notification-contract";
import { defineProcessModule, type PublishedProcessModule } from "@langwatch/process";

import { NotificationModule } from "./app/notification.app.ts";
import { webPushEventing } from "./eventing/web-push.pipeline.ts";
import { notificationRepositories } from "./repositories/notification-repositories.registry.ts";
import { notificationTrpcTransport } from "./transport/notification.trpc.ts";

export const notificationProcessModule: PublishedProcessModule<
  "notification",
  NotificationService,
  NotificationServerConfig
> = defineProcessModule("notification")
  .withRepositories(notificationRepositories)
  .withApi(NotificationModule)
  .withTransports(notificationTrpcTransport)
  .withEventing(webPushEventing);
