import { describe, expect, it } from "vitest";
import { DispatchError } from "@langwatch/dispatch-error";
import { sendWebhook } from "../appWebhookSender";

/**
 * The app-configured sender with the REAL strict SSRF validator — hostname
 * policy (cloud metadata endpoints) is the validator's to enforce, so it is
 * tested here rather than in the package, whose suite injects fakes.
 */
describe("appWebhookSender", () => {
  describe("when the URL is a cloud metadata hostname", () => {
    it("blocks it terminally before any connection", async () => {
      try {
        await sendWebhook({
          url: "https://metadata.google.internal/hook",
          body: "{}",
          triggerName: "My automation",
        });
        expect.unreachable("sendWebhook must throw");
      } catch (err) {
        expect(err).toBeInstanceOf(DispatchError);
        expect((err as DispatchError).retryable).toBe(false);
      }
    });
  });
});
