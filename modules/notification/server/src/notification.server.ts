import { defineModule } from "@langwatch/runtime-composition";
import { NotificationApp } from "./app/notification.app.ts";
import { notificationRepositories } from "./repositories/notification-repositories.registry.ts";

export const notificationServer = defineModule("notification")
  .withRepositories(notificationRepositories)
  .withApp(NotificationApp)
  .build();
