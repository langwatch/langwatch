import { describe, expect, it, vi } from "vitest";

const { webhook, send } = vi.hoisted(() => ({
  webhook: vi.fn(),
  send: vi.fn(),
}));

vi.mock("@slack/webhook", () => ({
  IncomingWebhook: webhook.mockImplementation(function () {
    return { send };
  }),
}));

import { AppSlackWebhookClientAdapter } from "../slack-webhook.client.adapter";

describe("AppSlackWebhookClientAdapter", () => {
  it("constructs an SDK sender for each tenant-owned webhook URL", async () => {
    send.mockResolvedValue(undefined);
    const client = AppSlackWebhookClientAdapter.create();

    await client.send({
      webhook: "https://hooks.slack.com/services/T1/B1/one",
      payload: { text: "first" },
    });
    await client.send({
      webhook: "https://hooks.slack.com/services/T2/B2/two",
      payload: { text: "second" },
    });

    expect(webhook).toHaveBeenNthCalledWith(1, "https://hooks.slack.com/services/T1/B1/one");
    expect(webhook).toHaveBeenNthCalledWith(2, "https://hooks.slack.com/services/T2/B2/two");
    expect(send).toHaveBeenNthCalledWith(1, { text: "first" });
    expect(send).toHaveBeenNthCalledWith(2, { text: "second" });
  });
});
