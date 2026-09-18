import type { FeatureSetup } from "@langwatch/kernel";
import {
  NotificationService as NotificationApi,
  type NotificationService as NotificationApiContract,
  type CreateNotificationCommand,
  type Notification,
  type NotificationRecentQuery,
} from "@langwatch/notification-contract";
import { Secret } from "@langwatch/secrets";

import type { NotificationRepositories } from "../repositories/notification.repositories.ts";
import { NotificationService } from "../services/notification.service.ts";

type NotificationSetup = FeatureSetup<
  typeof NotificationApp.dependencies,
  never,
  undefined,
  NotificationRepositories
>;

export class NotificationApp implements NotificationApiContract {
  static readonly contract = NotificationApi;
  static readonly dependencies = {};
  /** Never read here; the outbound mail gateway resolves each on first send. */
  static readonly secrets = {
    sendgrid: Secret.load("SENDGRID_API_KEY", { optional: true }),
    smtpUrl: Secret.load("SMTP_URL", { optional: true }),
    smtpPassword: Secret.load("SMTP_PASSWORD", { optional: true }),
    resend: Secret.load("RESEND_API_KEY", { optional: true }),
  } as const;

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
