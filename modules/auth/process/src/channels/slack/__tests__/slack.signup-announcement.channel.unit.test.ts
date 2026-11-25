// @vitest-environment node
import http from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { SlackSignupAnnouncementChannel } from "../slack.signup-announcement.channel.ts";

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

describe("SlackSignupAnnouncementChannel", () => {
  describe("given the signup Slack webhook is configured", () => {
    /** @scenario "The signup notice carries the message and none of the client's options" */
    it("posts the notice with no timeout field", async () => {
      const bodies: unknown[] = [];
      const webhookUrl = await webhookCapturing(bodies);

      await SlackSignupAnnouncementChannel.create({ webhookUrl }).post({
        text: "new signup",
        blocks: [],
      });

      expect(bodies).toEqual([{ text: "new signup", blocks: [] }]);
    });
  });
});
