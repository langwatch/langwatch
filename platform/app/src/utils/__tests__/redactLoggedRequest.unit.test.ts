import { describe, expect, it } from "vitest";
import { redactLoggedValue } from "../redactLoggedRequest";

describe("redactLoggedValue", () => {
  describe("given a webhook test-fire input", () => {
    /** @scenario "The development request log never shows header values or the signing secret" */
    it("keeps header names but masks their values and the signing secret", () => {
      const logged = redactLoggedValue({
        input: {
          projectId: "project-1",
          webhookDestination: {
            url: "https://hooks.example.com/in",
            method: "POST",
            headers: { Authorization: "Bearer s3cr3t", "X-Team": "ops" },
          },
          signingSecret: "whsec_abc",
        },
      });

      expect(logged).toEqual({
        input: {
          projectId: "project-1",
          webhookDestination: {
            url: "https://hooks.example.com/in",
            method: "POST",
            headers: { Authorization: "[redacted]", "X-Team": "[redacted]" },
          },
          signingSecret: "[redacted]",
        },
      });
      expect(JSON.stringify(logged)).not.toMatch(/s3cr3t|whsec_abc|ops"/);
    });
  });

  describe("given a Slack test-fire input", () => {
    it("masks the bot token and the incoming-webhook URL", () => {
      const logged = redactLoggedValue({
        webhook: "https://hooks.slack.com/services/T/B/X",
        botDestination: { channelId: "C123", botToken: "xoxb-1" },
      });

      expect(logged).toEqual({
        webhook: "[redacted]",
        botDestination: { channelId: "C123", botToken: "[redacted]" },
      });
    });
  });

  describe("given a value that is not a plain object", () => {
    it("returns it as it is", () => {
      const error = new Error("boom");
      expect(redactLoggedValue(error)).toBe(error);
      expect(redactLoggedValue("%c query")).toBe("%c query");
    });
  });
});
