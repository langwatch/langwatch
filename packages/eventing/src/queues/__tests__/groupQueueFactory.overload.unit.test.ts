import { GroupQueueError } from "@langwatch/group-queue";
import { HandledError } from "@langwatch/handled-error";
import { describe, expect, it } from "vitest";

import { backOffWhenOverloaded } from "../groupQueueFactory.ts";

/** Spec: packages/group-queue/specs/batch-bisection.feature */

const failed = (error: unknown) =>
  backOffWhenOverloaded({
    queueName: "{event-sourcing/jobs}",
    run: () => Promise.reject(error),
  }).catch((caught: unknown) => caught);

/** The client's refusal for a statement it shed, as the process store raises it. */
class ShedStatement extends HandledError {
  constructor({ reasons }: { reasons: readonly Error[] }) {
    super("clickhouse_overloaded", "clickhouse_overloaded", { reasons });
  }
}

const clickHouseError = (code: string, message: string) =>
  Object.assign(new Error(message), { code });

describe("backOffWhenOverloaded", () => {
  describe.each([
    ["241", "MEMORY_LIMIT_EXCEEDED"],
    ["241", "(total) memory limit exceeded: would use 2.50 GiB, maximum: 4.25 GiB"],
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

  describe("when one statement outgrows its own memory limit", () => {
    const overQueryLimit = clickHouseError(
      "241",
      "Query memory limit exceeded: would use 3.50 GiB (attempt to allocate chunk of 9.00 MiB), maximum: 3.50 GiB",
    );

    /** @scenario "A statement over its own memory limit splits the batch" */
    it("names no retry delay, so the queue splits the batch", async () => {
      const error = await failed(overQueryLimit);

      expect(error).toBeInstanceOf(GroupQueueError);
      expect(error).toMatchObject({ retryable: true, retryAfterMs: undefined });
      expect(error).toMatchObject({ cause: overQueryLimit });
    });

    it("recognises the older wording under a wrapping error", async () => {
      const wrapped = new Error("fold failed", {
        cause: clickHouseError("241", "Memory limit (for query) exceeded: would use 9.3 GiB"),
      });

      const error = await failed(wrapped);

      expect(error).toMatchObject({ retryAfterMs: undefined, cause: wrapped });
    });

    /** @scenario "A statement over its own memory limit splits the batch" */
    it("finds it among a handled refusal's reasons, as the resilient client raises it", async () => {
      const handled = new ShedStatement({
        reasons: [clickHouseError("241", "Memory limit (for query) exceeded: would use 9.3 GiB")],
      });

      const error = await failed(handled);

      expect(error).toMatchObject({ retryable: true, retryAfterMs: undefined, cause: handled });
    });
  });

  describe("when the client sheds an insert before it reaches the server", () => {
    it("names a retry delay, so the batch is retried whole and its writes are not lost", async () => {
      const shed = new ShedStatement({ reasons: [new Error("statement queue full")] });

      const error = await failed(shed);

      expect(error).toMatchObject({ retryable: true, retryAfterMs: 0, cause: shed });
    });
  });

  describe("when a single job fails on an overloaded server", () => {
    /** @scenario "A single job on an overloaded server takes the overload retry budget" */
    it("names a retry delay, so the job takes the overload retry budget", async () => {
      const cause = clickHouseError("202", "Too many simultaneous queries");

      const error = await backOffWhenOverloaded({
        queueName: "{event-sourcing/jobs}",
        unit: "job",
        run: () => Promise.reject(cause),
      }).catch((caught: unknown) => caught);

      expect(error).toMatchObject({ retryable: true, retryAfterMs: 0, operation: "process" });
    });
  });

  it("leaves a failure a smaller batch may fix unchanged, so it still splits", async () => {
    const failure = new Error("payload rejected by the fold");

    const error = await failed(failure);

    expect(error).toBe(failure);
  });
});
