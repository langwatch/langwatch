import { describe, expect, it } from "vitest";

import {
  findWebhookReceiverFailure,
  WEBHOOK_RECEIVER_FAILURE,
} from "../webhook-receiver-failure.ts";

function marked(failure: unknown): Error {
  return Object.assign(new Error("Webhook received HTTP 404"), {
    [WEBHOOK_RECEIVER_FAILURE]: failure,
  });
}

describe("findWebhookReceiverFailure", () => {
  describe("given a failure the receiver caused", () => {
    it("answers its status and whether a retry may pass", () => {
      expect(findWebhookReceiverFailure(marked({ status: 404, retryable: false }))).toEqual({
        status: 404,
        retryable: false,
      });
    });

    it("answers a null status for an endpoint that was never reached", () => {
      expect(findWebhookReceiverFailure(marked({ status: null, retryable: true }))).toEqual({
        status: null,
        retryable: true,
      });
    });
  });

  describe("given a failure that is not the receiver's", () => {
    it.each([
      ["an unmarked error", new Error("analytics unavailable")],
      ["a malformed mark", marked({ status: "404" })],
      ["a thrown string", "boom"],
      ["nothing", null],
    ])("answers null for %s", (_label, error) => {
      expect(findWebhookReceiverFailure(error)).toBeNull();
    });
  });
});
