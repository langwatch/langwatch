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

import type { CustomerIoTransactionalChannel } from "../channels/customer-io-transactional.channel.ts";
import {
  type EmailOutboundProxyConfig,
  type MailGatewaySettings,
  resolveDefaultFrom,
} from "../channels/email-delivery.channel.ts";
import { emailGatewayOpener } from "../channels/email-gateway-channels.registry.ts";
import { HttpCustomerIoTransactionalChannel } from "../channels/http/http.customer-io-transactional.channel.ts";
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

type NotificationSetup = FeatureSetup<
  typeof NotificationModule.dependencies,
  NotificationServerConfig,
  NotificationRepositories
>;

export class NotificationModule implements NotificationApiContract {
  static readonly contract = NotificationApi;
  static readonly dependencies = {};
  static readonly config = notificationConfig;
  static readonly publicConfig = notificationBrowserConfig.project;
  /** Resolved while the module constructs, before boot seals them. */
  static readonly secrets = {
    sendgrid: Secret.load("SENDGRID_API_KEY", { optional: true }),
    smtpUrl: Secret.load("SMTP_URL", { optional: true }),
    smtpPassword: Secret.load("SMTP_PASSWORD", { optional: true }),
    resend: Secret.load("RESEND_API_KEY", { optional: true }),
    /** Customer.io's App API key: LangWatch Cloud only, never in the self-hosted chart. */
    customerIoApp: Secret.load("CUSTOMER_IO_APP_API_KEY", { optional: true }),
  } as const;

  #notifications: NotificationService;
  #mailDelivery: MailDeliveryService;
  #webPush: WebPushService;
  #webPushQueue: WebPushQueue | undefined;

  private constructor(
    repositories: NotificationRepositories,
    mailDelivery: MailDeliveryService,
    webPush: { settings: VapidSettings; pushServiceBase: string | undefined },
  ) {
    this.#notifications = NotificationService.create({ repository: repositories.notifications });
    this.#mailDelivery = mailDelivery;
    this.#webPush = WebPushService.create({
      subscriptions: repositories.webPushSubscriptions,
      vapidKeys: repositories.webPushVapidKeys,
      gateway: HttpWebPushGatewayChannel.create({ pushServiceBase: webPush.pushServiceBase }),
      settings: webPush.settings,
      pushServiceBase: webPush.pushServiceBase,
      queue: () => this.#webPushQueue,
    });
  }

  static async create({
    repositories,
    config,
    secrets,
    resources,
  }: NotificationSetup): Promise<NotificationModule> {
    const settings = await mailGatewaySettings({ config, secrets });
    const configuration = {
      ...settings,
      defaultFrom: resolveDefaultFrom({
        ...(config.defaultFrom === undefined ? {} : { emailDefaultFrom: config.defaultFrom }),
        baseHost: config.publicBaseUrl ?? "",
      }),
    };
    const outboundProxy = parseOutboundProxyConfig(config.outboundProxy);
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
    const customerIo = await customerIoTransactional({ config, secrets, outboundProxy });
    if (customerIo) resources.own("Notification Customer.io client", () => customerIo.close());
    const mailDelivery = MailDeliveryService.create({
      settings: async () => settings,
      delivery,
      customerIo,
    });
    return new NotificationModule(repositories, mailDelivery, {
      settings: { publicBaseUrl: config.publicBaseUrl },
      pushServiceBase: config.webPushServiceBase,
    });
  }

  /** Web Push's pipeline over the kernel's process store, whose outbox holds the sends. */
  webPushPipeline({
    processStore,
    notifyOutbox,
  }: {
    processStore: ProcessStore;
    notifyOutbox?: (processName: string) => void;
  }): WebPushPipeline {
    this.#webPushQueue = OutboxWebPushQueue.create(processStore, notifyOutbox);
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

/**
 * Customer.io's client where this deployment routes mail through it, else undefined, and then
 * no send changes path. Only LangWatch Cloud holding the App API key builds one: a self-hosted
 * install has neither, so its mail goes the way it always went.
 */
async function customerIoTransactional({
  config,
  secrets,
  outboundProxy,
}: Pick<NotificationSetup, "config" | "secrets"> & {
  outboundProxy: EmailOutboundProxyConfig;
}): Promise<CustomerIoTransactionalChannel | undefined> {
  const apiKey = await secrets.into(NotificationModule.secrets.customerIoApp, (value) => value);
  if (!config.isSaas || !apiKey) return undefined;
  return HttpCustomerIoTransactionalChannel.create({
    apiKey,
    region: config.customerIoRegion,
    outboundProxy,
  });
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
