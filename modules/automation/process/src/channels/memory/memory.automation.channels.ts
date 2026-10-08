import type { AutomationChannels } from "../automation.channels.ts";
import type { SlackApiTransport } from "../slack/slack.web-api-delivery.channel.ts";
import type { SlackWebhookClientChannel } from "../slack/slack.webhook-client.channel.ts";

type SlackApiRequest = Parameters<SlackApiTransport["request"]>[0];

/** Records each Web API call and answers with Slack's `ok`. */
class MemorySlackApiTransportChannel implements SlackApiTransport {
  static create(): MemorySlackApiTransportChannel {
    return new MemorySlackApiTransportChannel();
  }

  readonly requests: SlackApiRequest[] = [];

  private constructor() {}

  async request(input: SlackApiRequest): Promise<{ status: number; body: string }> {
    this.requests.push(input);
    return { status: 200, body: JSON.stringify({ ok: true }) };
  }
}

type SlackWebhookSend = Parameters<SlackWebhookClientChannel["send"]>[0];

/** Records each incoming-webhook send instead of reaching Slack. */
class MemorySlackWebhookClientChannel implements Pick<SlackWebhookClientChannel, "send"> {
  static create(): MemorySlackWebhookClientChannel {
    return new MemorySlackWebhookClientChannel();
  }

  readonly sent: SlackWebhookSend[] = [];

  private constructor() {}

  async send(input: SlackWebhookSend): Promise<void> {
    this.sent.push(input);
  }
}

/** Slack sends are recorded in-process and always accepted. */
export class MemoryAutomationChannels {
  static readonly requires = [] as const;

  static create(): AutomationChannels {
    return {
      slackWebhookClient: MemorySlackWebhookClientChannel.create(),
      slackApiTransport: MemorySlackApiTransportChannel.create(),
    };
  }
}
