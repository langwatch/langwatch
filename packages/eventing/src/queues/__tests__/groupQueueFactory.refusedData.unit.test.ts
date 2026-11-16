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
    it("leaves its first attempts retryable, as a batch-mate's bad row fails every member", async () => {
      const cause = unparseable();

      expect(await failedOnAttempt(1, cause)).toBe(cause);
      expect(await failedOnAttempt(2, cause)).toBe(cause);
    });

    it("refuses it from the third attempt, instead of spending the whole retry budget", async () => {
      const cause = unparseable();

      const error = await failedOnAttempt(3, cause);

      expect(error).toBeInstanceOf(NonRetryableGroupQueueError);
      expect(error).toMatchObject({ cause });
    });

    it("keeps the unparsed row out of its own message", async () => {
      const error = await failedOnAttempt(3, unparseable());

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
