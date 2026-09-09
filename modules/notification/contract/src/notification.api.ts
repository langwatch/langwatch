import { moduleApi } from "@langwatch/runtime-composition";
import type {
  CreateNotificationCommand,
  Notification,
  NotificationRecentQuery,
} from "./notification.ts";

export interface NotificationApi {
  listRecentByOrganization(input: NotificationRecentQuery): Promise<Notification[]>;
  create(input: CreateNotificationCommand): Promise<Notification>;
}

export const NotificationApi = moduleApi<NotificationApi>("notification");
