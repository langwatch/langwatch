import type { SlackApiTransport } from "../slack/slack.web-api-delivery.channel.ts";

type SlackApiRequest = Parameters<SlackApiTransport["request"]>[0];

/** Records each Web API call and answers with Slack's `ok`. */
export class MemorySlackApiTransportChannel implements SlackApiTransport {
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
