import { moduleApi } from "@langwatch/module";

import type {
  CreateNotificationCommand,
  MailDeliveryView,
  Notification,
  NotificationRecentQuery,
  SendEmailCommand,
} from "./notification.ts";
import type {
  RequestWebPushDeliveryCommand,
  SubscribeWebPushCommand,
  UnsubscribeWebPushCommand,
  WebPushDeliveryRequested,
  WebPushPublicKey,
} from "./web-push.ts";

export interface NotificationService {
  listRecentByOrganization(input: NotificationRecentQuery): Promise<Notification[]>;
  create(input: CreateNotificationCommand): Promise<Notification>;
  /** Which gateway this install names for outbound mail, and whether SMTP is set up. */
  getMailDelivery(): Promise<MailDeliveryView>;
  /** Opens a connection to the SMTP relay and closes it; throws the relay's refusal. */
  verifySmtp(): Promise<void>;
  /** Sends one message through this install's gateway; with mail off it is skipped and logged. */
  sendEmail(input: SendEmailCommand): Promise<void>;
  /**
   * The VAPID public key browsers subscribe with: the configured pair where the deployment
   * names one, else this installation's own pair, generated and stored on first use.
   */
  getWebPushPublicKey(): Promise<WebPushPublicKey>;
  /** Stores one of the person's browsers; a browser that subscribes again replaces its row. */
  subscribeWebPush(input: SubscribeWebPushCommand): Promise<void>;
  /** Forgets one of the person's browsers; a browser the person does not hold is ignored. */
  unsubscribeWebPush(input: UnsubscribeWebPushCommand): Promise<void>;
  /**
   * Queues one push to every browser the person subscribed and answers at once; the worker
   * sends, retrying a busy push service. The same idempotency key queues nothing new.
   */
  requestWebPushDelivery(input: RequestWebPushDeliveryCommand): Promise<WebPushDeliveryRequested>;
}

export const NotificationService = moduleApi<NotificationService>()("notification");
