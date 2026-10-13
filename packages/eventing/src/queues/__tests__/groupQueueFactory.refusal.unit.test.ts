import { NonRetryableGroupQueueError } from "@langwatch/group-queue";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { refuseInvalidValueOnce } from "../groupQueueFactory.ts";

/** Spec: packages/eventing/specs/pipeline-retention.feature */

const schemaError = () => {
  const result = z.object({ retentionDays: z.number().positive() }).safeParse({ retentionDays: 0 });
  if (result.success) throw new Error("expected the value to fail its schema");
  return result.error;
};

const refused = (run: () => Promise<void>) =>
  refuseInvalidValueOnce({ queueName: "{event-sourcing/jobs}", run }).catch(
    (error: unknown) => error,
  );

describe("refuseInvalidValueOnce", () => {
  /** @scenario "A job whose value fails its schema is refused once, not retried" */
  it("turns a schema failure into a non-retryable one that keeps the cause", async () => {
    const cause = schemaError();

    const error = await refused(() => Promise.reject(cause));

    expect(error).toBeInstanceOf(NonRetryableGroupQueueError);
    expect(error).toMatchObject({ cause, message: expect.stringContaining("retentionDays") });
  });

  it("leaves every other failure retryable and unchanged", async () => {
    const transient = new Error("connection reset");

    const error = await refused(() => Promise.reject(transient));

    expect(error).toBe(transient);
  });
});
