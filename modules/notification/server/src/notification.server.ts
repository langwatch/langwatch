import { defineServerModule } from "@langwatch/runtime-composition";
import { NotificationApp } from "./app/notification.app.ts";
import { notificationRepositories } from "./repositories/notification-repositories.registry.ts";

export const notificationServer = defineServerModule("notification")
  .withRepositories(notificationRepositories)
  .withApp(NotificationApp)
  .build();
