import { HandBackGroupQueueError } from "@langwatch/group-queue";
import { describe, expect, it } from "vitest";

import { UnroutableQueuedJobError } from "../../services/errorHandling.ts";
import { handBackUnroutable } from "../groupQueueFactory.ts";

/** Spec: packages/eventing/specs/lane-alias.feature */

const failed = (run: () => Promise<void>) =>
  handBackUnroutable({ run }).catch((error: unknown) => error);

describe("handBackUnroutable", () => {
  /** @scenario "An unroutable job reaches the group queue as a hand-back, not a failure" */
  it("turns an unroutable refusal into a hand-back that keeps the cause", async () => {
    const cause = new UnroutableQueuedJobError({
      queueName: "{event-sourcing/jobs}",
      jobPath: "gateway_spend_processing:command:confirmSpend",
      context: {},
    });

    const error = await failed(() => Promise.reject(cause));

    expect(error).toBeInstanceOf(HandBackGroupQueueError);
    expect(error).toMatchObject({ cause });
  });

  it("leaves every other failure unchanged", async () => {
    const transient = new Error("connection reset");

    const error = await failed(() => Promise.reject(transient));

    expect(error).toBe(transient);
  });
});
