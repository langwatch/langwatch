/**
 * The bot connection's delivery leg. A webhook renders a subset of Block Kit;
 * a bot connection posts through `chat.postMessage`, which is what makes the
 * chart, table and alert blocks render at all. What this suite pins is the
 * call that carries the customer's token: where it goes, what it carries, and
 * which Slack refusals are worth retrying rather than dead-lettering.
 */
import type { SlackPayload } from "@langwatch/automation-contract";
import { DispatchError } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";
import {
  SlackWebApiDeliveryAdapter,
  type SlackApiTransport,
} from "../slack-web-api.delivery.adapter";

const PAYLOAD = {
  text: "A trace matched",
  blocks: [
    { type: "section", text: { type: "mrkdwn", text: "A trace matched" } },
    { type: "image", image_url: "https://langwatch.test/chart.png", alt_text: "chart" },
  ],
} as unknown as SlackPayload;

function transportAnswering(
  answer: { status: number; body: string } | (() => { status: number; body: string }),
) {
  const requests: Array<Parameters<SlackApiTransport["request"]>[0]> = [];

  const transport: SlackApiTransport = {
    request: async (input) => {
      requests.push(input);
      return typeof answer === "function" ? answer() : answer;
    },
  };

  return { transport, requests };
}

function post(transport: SlackApiTransport): Promise<void> {
  return SlackWebApiDeliveryAdapter.create(transport).post({
    token: "xoxb-secret",
    channel: "C123",
    payload: PAYLOAD,
    triggerName: "Thumbs down",
  });
}

describe("SlackWebApiDeliveryAdapter.post", () => {
  describe("given a Slack automation configured with a bot token and a channel", () => {
    describe("when it fires", () => {
      /** @scenario "An automation delivers through a Slack bot connection" */
      it("posts the message to that channel through the Slack Web API", async () => {
        const { transport, requests } = transportAnswering({
          status: 200,
          body: JSON.stringify({ ok: true }),
        });

        await expect(post(transport)).resolves.toBeUndefined();

        expect(requests).toHaveLength(1);
        expect(requests[0]!.url).toBe("https://slack.com/api/chat.postMessage");
        expect(requests[0]!.method).toBe("POST");
        expect(requests[0]!.headers.Authorization).toBe("Bearer xoxb-secret");
        expect(JSON.parse(requests[0]!.body)).toMatchObject({
          channel: "C123",
          blocks: PAYLOAD.blocks,
        });
      });

      /** @scenario "An automation delivers through a Slack bot connection" */
      it("sends the newer blocks as authored rather than degrading them", async () => {
        const { transport, requests } = transportAnswering({
          status: 200,
          body: JSON.stringify({ ok: true }),
        });

        await post(transport);

        const sent = JSON.parse(requests[0]!.body) as { blocks: Array<{ type: string }> };
        expect(sent.blocks.map(({ type }) => type)).toEqual(["section", "image"]);
      });
    });

    describe("when Slack rate-limits the send", () => {
      /** @scenario "An automation delivers through a Slack bot connection" */
      it("fails retryably, so the message is sent rather than dropped", async () => {
        const { transport } = transportAnswering({
          status: 200,
          body: JSON.stringify({ ok: false, error: "rate_limited" }),
        });

        await expect(post(transport)).rejects.toMatchObject({ retryable: true });
        await expect(post(transport)).rejects.toBeInstanceOf(DispatchError);
      });
    });

    describe("when Slack refuses the token", () => {
      /** @scenario "An automation delivers through a Slack bot connection" */
      it("fails permanently, because no retry can fix a misconfiguration", async () => {
        const { transport } = transportAnswering({
          status: 200,
          body: JSON.stringify({ ok: false, error: "invalid_auth" }),
        });

        await expect(post(transport)).rejects.toMatchObject({ retryable: false });
      });
    });
  });
});
