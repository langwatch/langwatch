import { GroupQueueError } from "@langwatch/group-queue";
import { describe, expect, it } from "vitest";

import { FoldStateNotVisibleError } from "../../services/errorHandling.ts";
import { retrySoonWhenFoldStateNotVisible } from "../groupQueueFactory.ts";

const failed = (error: unknown) =>
  retrySoonWhenFoldStateNotVisible({
    queueName: "{event-sourcing/jobs}",
    run: () => Promise.reject(error),
  }).catch((caught: unknown) => caught);

/** The retry delay a failure names, read off whatever the queue was handed. */
const retryAfterMsOf = (error: unknown): unknown =>
  error instanceof GroupQueueError ? error.retryAfterMs : undefined;

const notVisible = () =>
  new FoldStateNotVisibleError({
    projectionName: "codingAgentSession",
    aggregateId: "session-1",
    missing: "state",
    deliveryAttempt: 1,
  });

describe("retrySoonWhenFoldStateNotVisible", () => {
  describe("when a fold's saved state is not visible yet", () => {
    it("asks the queue for a retry 2 to 5 seconds later", async () => {
      const cause = notVisible();

      const error = await failed(cause);

      expect(error).toBeInstanceOf(GroupQueueError);
      expect(error).toMatchObject({ retryable: true, cause });
      expect(retryAfterMsOf(error)).toBeGreaterThanOrEqual(2_000);
      expect(retryAfterMsOf(error)).toBeLessThan(5_000);
    });

    it("spreads the waits of jobs that missed together", async () => {
      const errors = await Promise.all(Array.from({ length: 20 }, () => failed(notVisible())));
      const waits = errors.map(retryAfterMsOf);

      expect(new Set(waits).size).toBeGreaterThan(1);
    });

    it("finds it under a wrapping error", async () => {
      const wrapped = new Error("fold failed", { cause: notVisible() });

      const error = await failed(wrapped);

      expect(error).toBeInstanceOf(GroupQueueError);
      expect(retryAfterMsOf(error)).toBeGreaterThanOrEqual(2_000);
    });
  });

  describe("when the job fails for any other reason", () => {
    it("passes the failure through untouched", async () => {
      const cause = new Error("event_log unavailable");

      expect(await failed(cause)).toBe(cause);
    });
  });
});
