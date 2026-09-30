import { AwsClientConfiguration } from "@langwatch/aws-client";
import { parseOutboundProxyConfig } from "@langwatch/egress";
import type { FeatureSetup } from "@langwatch/kernel";
import {
  NotificationService as NotificationApi,
  notificationBrowserConfig,
  notificationConfig,
  type NotificationService as NotificationApiContract,
  type CreateNotificationCommand,
  type MailDeliveryView,
  type Notification,
  type NotificationRecentQuery,
  type NotificationServerConfig,
  type SendEmailCommand,
  sendEmailCommandSchema,
} from "@langwatch/notification-contract";
import { Secret } from "@langwatch/secrets";

import {
  type MailGatewaySettings,
  resolveDefaultFrom,
} from "../channels/email-delivery.channel.ts";
import { emailGatewayOpener } from "../channels/email-gateway-channels.registry.ts";
import { emailProxyResolver } from "../channels/ses/ses.email-gateway.channel.ts";
import type { NotificationRepositories } from "../repositories/notification.repositories.ts";
import { EmailDeliveryService } from "../services/email-delivery.service.ts";
import { MailDeliveryService } from "../services/mail-delivery.service.ts";
import { NotificationService } from "../services/notification.service.ts";

/**
 * Process facts: the sender address derives from the public base URL when unnamed,
 * and the SES and Resend calls follow the proxy spellings.
 */
type NotificationMembers = Readonly<{
  publicBaseUrl: string | undefined;
  outboundProxy: Readonly<Record<string, string | undefined>>;
}>;

type NotificationSetup = FeatureSetup<
  typeof NotificationApp.dependencies,
  NotificationMembers,
  NotificationServerConfig,
  NotificationRepositories
>;

export class NotificationApp implements NotificationApiContract {
  static readonly contract = NotificationApi;
  static readonly dependencies = {};
  static readonly reads = ["publicBaseUrl", "outboundProxy"] as const;
  static readonly config = notificationConfig;
  static readonly publicConfig = notificationBrowserConfig.project;
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
    members,
    resources,
  }: NotificationSetup): Promise<NotificationApp> {
    const settings = await mailGatewaySettings({ config, secrets });
    const configuration = {
      ...settings,
      defaultFrom: resolveDefaultFrom({
        ...(config.defaultFrom === undefined ? {} : { emailDefaultFrom: config.defaultFrom }),
        baseHost: members.publicBaseUrl ?? "",
      }),
    };
    const outboundProxy = parseOutboundProxyConfig(members.outboundProxy);
    const aws = AwsClientConfiguration.create({ outboundProxy: emailProxyResolver(outboundProxy) });
    resources.own("Notification AWS clients", () => aws.close());
    const delivery = EmailDeliveryService.create({
      configuration,
      openGateway: emailGatewayOpener({
        configuration,
        aws,
        outboundProxy,
      }),
    });
    resources.own("Notification mail gateway", () => delivery.close());
    const mailDelivery = MailDeliveryService.create({ settings: async () => settings, delivery });
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

  sendEmail(input: SendEmailCommand): Promise<void> {
    return this.#mailDelivery.sendEmail(sendEmailCommandSchema.parse(input));
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
