/**
 * @vitest-environment jsdom
 *
 * Verifies that isCancellableStatus is correctly re-exported from the
 * server-side canonical source. Full eligibility tests live in
 * server/scenarios/__tests__/cancellation-eligibility.unit.test.ts.
 *
 * @see specs/features/suites/cancel-queued-running-jobs.feature
 */
import { describe, expect, it } from "vitest";
import { isCancellableStatus } from "../useCancelScenarioRun";
import { isCancellableStatus as serverIsCancellableStatus } from "~/server/scenarios/cancellation";

describe("isCancellableStatus() re-export", () => {
  it("is the same function as the server-side canonical source", () => {
    expect(isCancellableStatus).toBe(serverIsCancellableStatus);
  });
});
