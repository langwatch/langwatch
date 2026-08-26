import { describe, expect, it } from "vitest";
import { isSlackWebhookUrl, slackActionParamsSchema } from "../src";

describe("Slack webhook URLs", () => {
  it("accepts genuine incoming webhook endpoints", () => {
    const url = "https://hooks.slack.com/services/T/B/X";

    expect(isSlackWebhookUrl(url)).toBe(true);
    expect(slackActionParamsSchema.safeParse({ slackWebhook: url }).success).toBe(true);
  });

  it.each([
    "https://hooks.slack.com@evil.example/services/T/B/X",
    "https://hooks.slack.com.evil.example/services/T/B/X",
    "http://hooks.slack.com/services/T/B/X",
    "https://hooks.slack.com/",
    "https://hooks.slack.com/not-services/T/B/X",
  ])("rejects %s", (url) => {
    expect(isSlackWebhookUrl(url)).toBe(false);
    expect(slackActionParamsSchema.safeParse({ slackWebhook: url }).success).toBe(false);
  });
});
