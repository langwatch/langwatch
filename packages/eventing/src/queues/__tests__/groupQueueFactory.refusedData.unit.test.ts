import { NonRetryableGroupQueueError } from "@langwatch/group-queue";
import { describe, expect, it } from "vitest";

import { stopRetryingRefusedData } from "../groupQueueFactory.ts";

/** ClickHouse refusing a row it cannot parse, as @clickhouse/client raises it. */
const unparseable = () =>
  Object.assign(new Error("Cannot parse input: expected '\"' before: 'secret row'"), {
    code: "27",
    type: "CANNOT_PARSE_INPUT_ASSERTION_FAILED",
  });

const failedOnAttempt = (attempt: number, error: unknown) =>
  stopRetryingRefusedData({
    queueName: "{event-sourcing/jobs}",
    attempt,
    run: () => Promise.reject(error),
  }).catch((caught: unknown) => caught);

describe("stopRetryingRefusedData", () => {
  describe("given a single job whose data ClickHouse refuses", () => {
    /** @scenario "A job whose data ClickHouse refuses stops retrying from its eighth attempt" */
    it("leaves early attempts retryable, as a flush-mate's bad row fails them all", async () => {
      const cause = unparseable();

      expect(await failedOnAttempt(1, cause)).toBe(cause);
      expect(await failedOnAttempt(3, cause)).toBe(cause);
    });

    it("keeps it retryable until its jittered waits outlast a shared flush", async () => {
      const cause = unparseable();

      expect(await failedOnAttempt(7, cause)).toBe(cause);
    });

    /** @scenario "A job whose data ClickHouse refuses stops retrying from its eighth attempt" */
    it("refuses it from the eighth attempt, not the end of the retry budget", async () => {
      const cause = unparseable();

      const error = await failedOnAttempt(8, cause);

      expect(error).toBeInstanceOf(NonRetryableGroupQueueError);
      expect(error).toMatchObject({ cause });
    });

    it("keeps the unparsed row out of its own message", async () => {
      const error = await failedOnAttempt(8, unparseable());

      expect(error).toBeInstanceOf(NonRetryableGroupQueueError);
      expect(error).not.toMatchObject({ message: expect.stringContaining("secret row") });
    });
  });

  describe("given any other failure, however late", () => {
    it("leaves it retryable and unchanged", async () => {
      const transient = Object.assign(new Error("Too many simultaneous queries"), { code: "202" });

      expect(await failedOnAttempt(10, transient)).toBe(transient);
    });
  });

  it("returns what the job returns when it succeeds", async () => {
    await expect(
      stopRetryingRefusedData({ queueName: "q", attempt: 5, run: async () => "done" }),
    ).resolves.toBe("done");
  });
});
