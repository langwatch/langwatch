import { AwsClientConfiguration } from "@langwatch/aws-client";
import { parseOutboundProxyConfig } from "@langwatch/egress";
import type { ProcessStore } from "@langwatch/eventing";
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
  type RequestWebPushDeliveryCommand,
  type SendEmailCommand,
  sendEmailCommandSchema,
  type SubscribeWebPushCommand,
  type UnsubscribeWebPushCommand,
  type WebPushDeliveryRequested,
  type WebPushPublicKey,
} from "@langwatch/notification-contract";
import type { FeatureSetup } from "@langwatch/process";
import { Secret } from "@langwatch/secrets";

import {
  type MailGatewaySettings,
  resolveDefaultFrom,
} from "../channels/email-delivery.channel.ts";
import { emailGatewayOpener } from "../channels/email-gateway-channels.registry.ts";
import { HttpWebPushGatewayChannel } from "../channels/http/http.web-push-gateway.channel.ts";
import { emailProxyResolver } from "../channels/ses/ses.email-gateway.channel.ts";
import {
  buildWebPushPipeline,
  OutboxWebPushQueue,
  type WebPushPipeline,
} from "../eventing/web-push.pipeline.ts";
import type { NotificationRepositories } from "../repositories/notification.repositories.ts";
import type { VapidSettings } from "../rules/web-push.rules.ts";
import { EmailDeliveryService } from "../services/email-delivery.service.ts";
import { MailDeliveryService } from "../services/mail-delivery.service.ts";
import { NotificationService } from "../services/notification.service.ts";
import { WebPushService, type WebPushQueue } from "../services/web-push.service.ts";

/**
 * Process facts: the sender address derives from the public base URL when unnamed,
 * and the SES and Resend calls follow the proxy spellings.
 */
type NotificationMembers = Readonly<{
  publicBaseUrl: string | undefined;
  outboundProxy: Readonly<Record<string, string | undefined>>;
}>;

type NotificationSetup = FeatureSetup<
  typeof NotificationModule.dependencies,
  NotificationMembers,
  NotificationServerConfig,
  NotificationRepositories
>;

export class NotificationModule implements NotificationApiContract {
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
  #webPush: WebPushService;
  #webPushQueue: WebPushQueue | undefined;

  private constructor(
    repositories: NotificationRepositories,
    mailDelivery: MailDeliveryService,
    webPushSettings: VapidSettings,
  ) {
    this.#notifications = NotificationService.create({ repository: repositories.notifications });
    this.#mailDelivery = mailDelivery;
    this.#webPush = WebPushService.create({
      subscriptions: repositories.webPushSubscriptions,
      vapidKeys: repositories.webPushVapidKeys,
      gateway: HttpWebPushGatewayChannel.create(),
      settings: webPushSettings,
      queue: () => this.#webPushQueue,
    });
  }

  static async create({
    repositories,
    config,
    secrets,
    members,
    resources,
  }: NotificationSetup): Promise<NotificationModule> {
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
    return new NotificationModule(repositories, mailDelivery, {
      publicBaseUrl: members.publicBaseUrl,
    });
  }

  /** Web Push's pipeline over the kernel's process store, whose outbox holds the sends. */
  webPushPipeline({ processStore }: { processStore: ProcessStore }): WebPushPipeline {
    this.#webPushQueue = OutboxWebPushQueue.create(processStore);
    return buildWebPushPipeline({ webPush: this.#webPush, processStore });
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

  getWebPushPublicKey(): Promise<WebPushPublicKey> {
    return this.#webPush.getPublicKey();
  }

  subscribeWebPush(input: SubscribeWebPushCommand): Promise<void> {
    return this.#webPush.subscribe(input);
  }

  unsubscribeWebPush(input: UnsubscribeWebPushCommand): Promise<void> {
    return this.#webPush.unsubscribe(input);
  }

  requestWebPushDelivery(input: RequestWebPushDeliveryCommand): Promise<WebPushDeliveryRequested> {
    return this.#webPush.request(input);
  }
}

/** This deployment's gateway settings: its config slice, and the credentials the chain resolves. */
async function mailGatewaySettings({
  config,
  secrets,
}: Pick<NotificationSetup, "config" | "secrets">): Promise<MailGatewaySettings> {
  const handles = NotificationModule.secrets;
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
