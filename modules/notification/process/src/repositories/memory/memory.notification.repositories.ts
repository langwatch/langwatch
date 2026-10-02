import type { NotificationRepositories } from "../notification.repositories.ts";
import { MemoryNotificationRepository } from "./memory.notification.repository.ts";
import { MemoryWebPushSubscriptionRepository } from "./memory.web-push-subscription.repository.ts";
import { MemoryWebPushVapidKeyRepository } from "./memory.web-push-vapid-key.repository.ts";

export class MemoryNotificationRepositories {
  static readonly requires = [] as const;

  static create(): NotificationRepositories {
    return {
      notifications: MemoryNotificationRepository.create(),
      webPushSubscriptions: MemoryWebPushSubscriptionRepository.create(),
      webPushVapidKeys: MemoryWebPushVapidKeyRepository.create(),
    };
  }
}
