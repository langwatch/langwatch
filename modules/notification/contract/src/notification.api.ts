import { moduleApi } from "@langwatch/runtime-composition";
import type {
  CreateNotificationCommand,
  Notification,
  NotificationRecentQuery,
} from "./notification.ts";

export interface NotificationService {
  listRecentByOrganization(input: NotificationRecentQuery): Promise<Notification[]>;
  create(input: CreateNotificationCommand): Promise<Notification>;
}

export const NotificationService = moduleApi<NotificationService>()("notification");
