import { GroupQueueError } from "@langwatch/group-queue";
import { describe, expect, it } from "vitest";

import { backOffWhenOverloaded } from "../groupQueueFactory.ts";

/** Spec: packages/group-queue/specs/batch-bisection.feature */

const failed = (error: unknown) =>
  backOffWhenOverloaded({
    queueName: "{event-sourcing/jobs}",
    run: () => Promise.reject(error),
  }).catch((caught: unknown) => caught);

const clickHouseError = (code: string, message: string) =>
  Object.assign(new Error(message), { code });

describe("backOffWhenOverloaded", () => {
  describe.each([
    ["241", "MEMORY_LIMIT_EXCEEDED"],
    ["202", "Too many simultaneous queries"],
    ["159", "TIMEOUT_EXCEEDED"],
  ])("when ClickHouse answers code %s", (code, message) => {
    it("names a retry delay so the queue backs the batch off whole", async () => {
      const cause = clickHouseError(code, message);

      const error = await failed(cause);

      expect(error).toBeInstanceOf(GroupQueueError);
      expect(error).toMatchObject({ retryable: true, retryAfterMs: 0, cause });
      expect(error).toMatchObject({ message: expect.stringContaining(`code ${code}`) });
    });
  });

  it("finds the overload under a wrapping error", async () => {
    const wrapped = new Error("fold failed", {
      cause: clickHouseError("241", "MEMORY_LIMIT_EXCEEDED"),
    });

    const error = await failed(wrapped);

    expect(error).toMatchObject({ retryAfterMs: 0, cause: wrapped });
  });

  it("leaves a failure a smaller batch may fix unchanged, so it still splits", async () => {
    const failure = new Error("payload rejected by the fold");

    const error = await failed(failure);

    expect(error).toBe(failure);
  });
});
