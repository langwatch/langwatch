import type { NotificationRepository } from "./notification.repository.ts";
import type { WebPushSubscriptionRepository } from "./web-push-subscription.repository.ts";
import type { WebPushVapidKeyRepository } from "./web-push-vapid-key.repository.ts";

export interface NotificationRepositories {
  readonly notifications: NotificationRepository;
  readonly webPushSubscriptions: WebPushSubscriptionRepository;
  readonly webPushVapidKeys: WebPushVapidKeyRepository;
}
