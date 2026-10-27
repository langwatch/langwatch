import type { NotificationRepositories } from "../notification.repositories.ts";
import type { VapidKeyPair, WebPushVapidKeyRepository } from "../web-push-vapid-key.repository.ts";
import { MemoryNotificationRepository } from "./memory.notification.repository.ts";
import { MemoryWebPushSubscriptionRepository } from "./memory.web-push-subscription.repository.ts";

export class MemoryWebPushVapidKeyRepository implements WebPushVapidKeyRepository {
  #pair: VapidKeyPair | null = null;

  private constructor() {}

  static create(): MemoryWebPushVapidKeyRepository {
    return new MemoryWebPushVapidKeyRepository();
  }

  async find(): Promise<VapidKeyPair | null> {
    return this.#pair ? { ...this.#pair } : null;
  }

  async insertIfAbsent(pair: VapidKeyPair): Promise<VapidKeyPair> {
    this.#pair ??= { ...pair };
    return { ...this.#pair };
  }
}

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
