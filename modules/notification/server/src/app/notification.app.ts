import {
  NotificationApi,
  type CreateNotificationCommand,
  type Notification,
  type NotificationRecentQuery,
} from "@langwatch/notification-contract";
import type { FeatureSetup } from "@langwatch/runtime-composition";
import type { NotificationRepositories } from "../repositories/notification.repositories.ts";
import { NotificationService } from "../services/notification.service.ts";

type NotificationSetup = FeatureSetup<
  typeof NotificationApp.dependencies,
  never,
  undefined,
  NotificationRepositories
>;

export class NotificationApp implements NotificationApi {
  static readonly contract = NotificationApi;
  static readonly dependencies = {};

  #notifications: NotificationService;

  private constructor(repositories: NotificationRepositories) {
    this.#notifications = NotificationService.create({ repository: repositories.notifications });
  }

  static create({ repositories }: NotificationSetup): NotificationApp {
    return new NotificationApp(repositories);
  }

  listRecentByOrganization(input: NotificationRecentQuery): Promise<Notification[]> {
    return this.#notifications.listRecentByOrganization(input);
  }

  create(input: CreateNotificationCommand): Promise<Notification> {
    return this.#notifications.create(input);
  }
}
