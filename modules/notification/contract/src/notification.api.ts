import { moduleApi } from "@langwatch/kernel/module-api";

import type {
  CreateNotificationCommand,
  MailDeliveryView,
  Notification,
  NotificationRecentQuery,
} from "./notification.ts";

export interface NotificationService {
  listRecentByOrganization(input: NotificationRecentQuery): Promise<Notification[]>;
  create(input: CreateNotificationCommand): Promise<Notification>;
  /** Which gateway this install names for outbound mail, and whether SMTP is set up. */
  getMailDelivery(): Promise<MailDeliveryView>;
  /** Opens a connection to the SMTP relay and closes it; throws the relay's refusal. */
  verifySmtp(): Promise<void>;
}

export const NotificationService = moduleApi<NotificationService>()("notification");
