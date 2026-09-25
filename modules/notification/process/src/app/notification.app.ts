import type { FeatureSetup } from "@langwatch/kernel";
import {
  NotificationService as NotificationApi,
  notificationConfig,
  type NotificationService as NotificationApiContract,
  type CreateNotificationCommand,
  type MailDeliveryView,
  type Notification,
  type NotificationRecentQuery,
  type NotificationServerConfig,
} from "@langwatch/notification-contract";
import { Secret } from "@langwatch/secrets";

import type { MailGatewaySettings } from "../channels/email-delivery.channel.ts";
import type { NotificationRepositories } from "../repositories/notification.repositories.ts";
import { MailDeliveryService } from "../services/mail-delivery.service.ts";
import { NotificationService } from "../services/notification.service.ts";

type NotificationSetup = FeatureSetup<
  typeof NotificationApp.dependencies,
  never,
  NotificationServerConfig,
  NotificationRepositories
>;

export class NotificationApp implements NotificationApiContract {
  static readonly contract = NotificationApi;
  static readonly dependencies = {};
  static readonly config = notificationConfig;
  /** Resolved while the module constructs, before boot seals them. */
  static readonly secrets = {
    sendgrid: Secret.load("SENDGRID_API_KEY", { optional: true }),
    smtpUrl: Secret.load("SMTP_URL", { optional: true }),
    smtpPassword: Secret.load("SMTP_PASSWORD", { optional: true }),
    resend: Secret.load("RESEND_API_KEY", { optional: true }),
  } as const;

  #notifications: NotificationService;
  #mailDelivery: MailDeliveryService;

  private constructor(repositories: NotificationRepositories, mailDelivery: MailDeliveryService) {
    this.#notifications = NotificationService.create({ repository: repositories.notifications });
    this.#mailDelivery = mailDelivery;
  }

  static async create({
    repositories,
    config,
    secrets,
  }: NotificationSetup): Promise<NotificationApp> {
    const settings = await mailGatewaySettings({ config, secrets });
    const mailDelivery = MailDeliveryService.create({ settings: async () => settings });
    return new NotificationApp(repositories, mailDelivery);
  }

  listRecentByOrganization(input: NotificationRecentQuery): Promise<Notification[]> {
    return this.#notifications.listRecentByOrganization(input);
  }

  create(input: CreateNotificationCommand): Promise<Notification> {
    return this.#notifications.create(input);
  }

  getMailDelivery(): Promise<MailDeliveryView> {
    return this.#mailDelivery.getView();
  }

  verifySmtp(): Promise<void> {
    return this.#mailDelivery.verifySmtp();
  }
}

/** This deployment's gateway settings: its config slice, and the credentials the chain resolves. */
async function mailGatewaySettings({
  config,
  secrets,
}: Pick<NotificationSetup, "config" | "secrets">): Promise<MailGatewaySettings> {
  const handles = NotificationApp.secrets;
  const [sendgrid, smtpUrl, smtpPassword, resend] = await Promise.all([
    secrets.into(handles.sendgrid, (value) => value),
    secrets.into(handles.smtpUrl, (value) => value),
    secrets.into(handles.smtpPassword, (value) => value),
    secrets.into(handles.resend, (value) => value),
  ]);
  return {
    provider: config.provider,
    ses: {
      enabled: Boolean(config.ses.enabled),
      region: config.ses.region,
      endpoint: config.ses.endpoint,
    },
    sendgrid: { apiKey: sendgrid },
    smtp: {
      url: smtpUrl,
      host: config.smtp.host,
      port: config.smtp.port,
      user: config.smtp.user,
      password: smtpPassword,
      secure: config.smtp.secure,
    },
    resend: { apiKey: resend },
  };
}
