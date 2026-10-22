import { describe, expect, it } from "vitest";

import { defaultFailureDecision, GroupQueueError, NonRetryableGroupQueueError } from "../errors.ts";

/** Spec: specs/eventing/deleted-project-jobs.feature */

/** Shaped as HandledError: `retryable` always set, `fault` derived from the status. */
const refusal = (shape: { retryable: boolean; httpStatus: number; fault?: string }) =>
  Object.assign(new Error("refused"), shape);

describe("defaultFailureDecision", () => {
  describe("given an error that says it is not retryable", () => {
    /** @scenario "A failure that says it is not retryable is not retried" */
    it("refuses a customer-fault refusal and a typed dispatch error at once", () => {
      expect(
        defaultFailureDecision(refusal({ retryable: false, httpStatus: 404, fault: "customer" })),
      ).toEqual({ retryable: false });
      expect(
        defaultFailureDecision(refusal({ retryable: false, httpStatus: 503, fault: "customer" })),
      ).toEqual({ retryable: false });
      expect(
        defaultFailureDecision(Object.assign(new Error("HTTP 410"), { retryable: false })),
      ).toEqual({ retryable: false });
    });

    it("still refuses the queue's own non-retryable errors", () => {
      expect(defaultFailureDecision(new NonRetryableGroupQueueError("bad value"))).toEqual({
        retryable: false,
      });
      expect(
        defaultFailureDecision(
          new GroupQueueError({ queueName: "q", operation: "o", message: "m", retryable: false }),
        ),
      ).toEqual({ retryable: false });
    });
  });

  describe("given a platform, provider or rate-limit refusal marked not retryable", () => {
    /** @scenario "A platform or rate-limit failure still retries even when it is marked retryable false" */
    it("retries it as before", () => {
      for (const shape of [
        { retryable: false, httpStatus: 503, fault: "platform" },
        { retryable: false, httpStatus: 502, fault: "provider" },
        { retryable: false, httpStatus: 500, fault: "presumed_platform" },
        { retryable: false, httpStatus: 429, fault: "customer" },
        { retryable: false, httpStatus: 504 },
      ]) {
        expect(defaultFailureDecision(refusal(shape))).toEqual({ retryable: true });
      }
    });
  });

  describe("given an error that says nothing about retrying", () => {
    it("retries it", () => {
      expect(defaultFailureDecision(new Error("connection reset"))).toEqual({ retryable: true });
      expect(defaultFailureDecision("boom")).toEqual({ retryable: true });
      expect(
        defaultFailureDecision(Object.assign(new Error("flaky"), { retryable: true })),
      ).toEqual({ retryable: true });
    });
  });
});
