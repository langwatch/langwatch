import { featureApi } from "@langwatch/runtime-composition/contract";
import type {
  CreateNotificationCommand,
  Notification,
  NotificationRecentQuery,
} from "./notification.ts";

export interface NotificationApi {
  listRecentByOrganization(input: NotificationRecentQuery): Promise<Notification[]>;
  create(input: CreateNotificationCommand): Promise<Notification>;
}

export const NotificationApi = featureApi<NotificationApi>("notification");
