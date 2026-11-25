// @vitest-environment node
import http from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { SlackBillingAlertChannel } from "../slack.billing-alert.channel.ts";

const listeners: http.Server[] = [];
afterEach(async () => {
  await Promise.all(
    listeners
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

/** A stand-in incoming webhook that answers "ok" and keeps each body it was sent. */
async function webhookCapturing(bodies: unknown[]): Promise<string> {
  const server = http.createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk: Buffer) => (raw += chunk.toString()));
    request.on("end", () => {
      bodies.push(JSON.parse(raw));
      response.end("ok");
    });
  });
  listeners.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;
}

describe("SlackBillingAlertChannel", () => {
  describe("given a billing alert posted to a Slack incoming webhook", () => {
    /** @scenario "A billing Slack notice carries the message and none of the client's options" */
    it("sends the message's fields and no timeout", async () => {
      const bodies: unknown[] = [];
      const webhookUrl = await webhookCapturing(bodies);

      await SlackBillingAlertChannel.create().send({
        webhookUrl,
        message: { text: "limit reached" },
      });

      expect(bodies).toEqual([{ text: "limit reached" }]);
    });
  });
});
