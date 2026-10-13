import { beforeEach, describe, expect, it, vi } from "vitest";

import { SlackWebApiTransportChannel } from "../slack.web-api-transport.channel.ts";
import { SlackWebhookClientChannel } from "../slack.webhook-client.channel.ts";

const webhookUrls = vi.hoisted(() => [] as string[]);

vi.mock("@slack/webhook", () => ({
  IncomingWebhook: class {
    constructor(url: string) {
      webhookUrls.push(url);
    }
    async send(): Promise<void> {}
  },
}));

const WEBHOOK = "https://hooks.slack.com/services/T0/B0/secret";
const SIM = "https://outbound.x.langwatch.localhost";

function recordingFetch(): { fetch: typeof globalThis.fetch; urls: string[] } {
  const urls: string[] = [];
  const fetch: typeof globalThis.fetch = async (input) => {
    urls.push(new Request(input).url);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  return { fetch, urls };
}

async function postBoth(options: { apiBase?: string; webhookBase?: string }): Promise<string[]> {
  const { fetch, urls } = recordingFetch();
  await SlackWebApiTransportChannel.create({ fetch, apiBase: options.apiBase }).request({
    url: "https://slack.com/api/chat.postMessage",
    method: "POST",
    headers: {},
    body: "{}",
    contextLabel: "test",
  });
  await SlackWebhookClientChannel.create({ webhookBase: options.webhookBase }).send({
    webhook: WEBHOOK,
    payload: { text: "hi" },
  });
  return [...urls, ...webhookUrls];
}

describe("Slack delivery addresses", () => {
  beforeEach(() => {
    webhookUrls.length = 0;
  });

  /** @scenario "Slack deliveries reach the configured Slack addresses" */
  it("sends the Web API call and the webhook to the configured stand-in", async () => {
    expect(await postBoth({ apiBase: `${SIM}/api/`, webhookBase: SIM })).toEqual([
      `${SIM}/api/chat.postMessage`,
      `${SIM}/services/T0/B0/secret`,
    ]);
  });

  /** @scenario "Slack deliveries reach Slack itself by default" */
  it("sends both to Slack when no address is configured", async () => {
    expect(await postBoth({})).toEqual(["https://slack.com/api/chat.postMessage", WEBHOOK]);
  });
});
