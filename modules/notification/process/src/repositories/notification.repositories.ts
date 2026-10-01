import type { NotificationRepository } from "./notification.repository.ts";

export interface NotificationRepositories {
  readonly notifications: NotificationRepository;
}
