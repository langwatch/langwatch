import { defineFeature } from "@langwatch/runtime-composition";
import { NotificationApp } from "./app/notification.app.ts";

export type { NotificationInfrastructure } from "./app/notification.app.ts";

export const notificationServer = defineFeature("notification").withApp(NotificationApp).build();
