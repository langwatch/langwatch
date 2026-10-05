import { generate } from "@langwatch/ksuid";
import {
  EmailProviderNotConfiguredError,
  type NotificationService,
} from "@langwatch/notification-contract";
import type { WebhookApi } from "@langwatch/webhook-contract";

import type { AutomationNotificationDelivery } from "../channels/automation-notification-delivery.channel.ts";
import {
  AutomationTestFire,
  TEST_FIRE_TRIGGER_ID_SENTINEL,
  type TestFireEmail,
  type TestFireSlackBot,
  type TestFireSlackWebhook,
  type TestFireWebhook,
} from "../channels/automation-test-fire.channel.ts";

/** A test fire takes the real fire's transports: notification's mail, Slack, the webhook module. */
export class AutomationTestFireService extends AutomationTestFire {
  static create(input: {
    mail: Pick<NotificationService, "sendEmail" | "getMailDelivery">;
    delivery: Pick<AutomationNotificationDelivery, "sendSlackWebhook" | "sendSlackBot">;
    webhooks: Pick<WebhookApi, "sendRequest">;
  }): AutomationTestFireService {
    return new AutomationTestFireService(input.mail, input.delivery, input.webhooks);
  }

  private constructor(
    private readonly mail: Pick<NotificationService, "sendEmail" | "getMailDelivery">,
    private readonly delivery: Pick<
      AutomationNotificationDelivery,
      "sendSlackWebhook" | "sendSlackBot"
    >,
    private readonly webhooks: Pick<WebhookApi, "sendRequest">,
  ) {
    super();
  }

  /** Refuses with no mail provider (ARCHITECTURE.md §6), where a real send skips quietly. */
  async sendEmail(input: TestFireEmail): Promise<void> {
    const { provider } = await this.mail.getMailDelivery();
    if (provider === undefined) throw new EmailProviderNotConfiguredError();
    await this.mail.sendEmail({ to: input.recipients, subject: input.subject, html: input.html });
  }

  sendSlack(input: TestFireSlackWebhook): Promise<void> {
    return this.delivery.sendSlackWebhook({ ...input, triggerName: "test fire" });
  }

  sendSlackBot(input: TestFireSlackBot): Promise<void> {
    return this.delivery.sendSlackBot({ ...input, triggerName: "test fire" });
  }

  /** A test fire (ADR-040 §1): uncapped, never logged; a non-2xx throws the classified error. */
  async sendWebhook(input: TestFireWebhook): Promise<{ status: number }> {
    const { status } = await this.webhooks.sendRequest({
      projectId: TEST_FIRE_TRIGGER_ID_SENTINEL,
      url: input.url,
      method: input.method,
      headers: input.headers,
      body: input.body,
      contentType: input.contentType,
      signingSecrets: input.signingSecrets,
      dispatchId: generate("event").toString(),
      label: `Webhook for trigger "${input.triggerName}"`,
      source: { module: "automation", ref: TEST_FIRE_TRIGGER_ID_SENTINEL },
      testFire: true,
    });
    return { status };
  }
}
