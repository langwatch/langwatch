import { moduleApi } from "@langwatch/kernel/module-api";

import type {
  CreateNotificationCommand,
  MailDeliveryView,
  Notification,
  NotificationRecentQuery,
  SendEmailCommand,
} from "./notification.ts";
import type { ReadHint, ReadHintsWatchInput } from "./read-hints.ts";

export interface NotificationService {
  listRecentByOrganization(input: NotificationRecentQuery): Promise<Notification[]>;
  create(input: CreateNotificationCommand): Promise<Notification>;
  /** Which gateway this install names for outbound mail, and whether SMTP is set up. */
  getMailDelivery(): Promise<MailDeliveryView>;
  /** Opens a connection to the SMTP relay and closes it; throws the relay's refusal. */
  verifySmtp(): Promise<void>;
  /** Sends one message through this install's gateway; with mail off it is skipped and logged. */
  sendEmail(input: SendEmailCommand): Promise<void>;
  /** The read hints of one user, organization and project until the signal aborts. */
  readHints(input: ReadHintsWatchInput): AsyncIterable<ReadHint>;
}

export const NotificationService = moduleApi<NotificationService>()("notification");
