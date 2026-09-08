import type { NotificationRepositories } from "../notification.repositories.ts";
import { MemoryNotificationRepository } from "./memory.notification.repository.ts";

export class MemoryNotificationRepositories {
  static readonly requires = [] as const;

  static create(): NotificationRepositories {
    return { notifications: MemoryNotificationRepository.create() };
  }
}
