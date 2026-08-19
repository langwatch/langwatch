/**
 * @vitest-environment node
 *
 * @see specs/scenarios/simulation-runs-api.feature
 */
import { describe, expect, it } from "vitest";

import type { ScenarioRunData } from "~/server/scenarios/scenario-event.types";
import {
  capRunsAtBatchBoundary,
  clampPageLimit,
  FULL_MESSAGES_PAGE_LIMIT,
  LIST_PAGE_LIMIT,
} from "../repositories/simulation.clickhouse.repository";

describe("clampPageLimit()", () => {
  describe("when the caller reads the trimmed projection", () => {
    it("allows up to the list ceiling", () => {
      expect(clampPageLimit({ limit: 100, shouldIncludeMessages: false })).toBe(
        LIST_PAGE_LIMIT,
      );
      expect(clampPageLimit({ limit: 20, shouldIncludeMessages: false })).toBe(
        20,
      );
    });
  });

  describe("when the caller asks for whole conversations", () => {
    /** @scenario "include=messages caps the page size" */
    it("reduces the page to the full-message cap", () => {
      expect(clampPageLimit({ limit: 100, shouldIncludeMessages: true })).toBe(
        FULL_MESSAGES_PAGE_LIMIT,
      );
    });

    it("leaves a page already under the cap alone", () => {
      expect(clampPageLimit({ limit: 5, shouldIncludeMessages: true })).toBe(5);
    });
  });

  describe("when the limit is below one", () => {
    it("floors at a single run", () => {
      expect(clampPageLimit({ limit: 0, shouldIncludeMessages: false })).toBe(
        1,
      );
      expect(clampPageLimit({ limit: -3, shouldIncludeMessages: true })).toBe(
        1,
      );
    });
  });
});

describe("capRunsAtBatchBoundary()", () => {
  const makeBatch = ({
    batchRunId,
    count,
  }: {
    batchRunId: string;
    count: number;
  }) =>
    Array.from(
      { length: count },
      (_, index) =>
        ({
          batchRunId,
          scenarioRunId: `${batchRunId}-run-${index}`,
        }) as unknown as ScenarioRunData,
    );

  describe("given the selected batches together hold more runs than the cap", () => {
    /** @scenario "include=messages stops the page at the batch that would pass the run cap" */
    it("keeps only the batches that fit", () => {
      const batchRunIds = ["batch-a", "batch-b", "batch-c"];
      const runs = [
        ...makeBatch({ batchRunId: "batch-a", count: 12 }),
        ...makeBatch({ batchRunId: "batch-b", count: 6 }),
        ...makeBatch({ batchRunId: "batch-c", count: 9 }),
      ];

      const capped = capRunsAtBatchBoundary({
        runs,
        batchRunIds,
        ceiling: FULL_MESSAGES_PAGE_LIMIT,
      });

      expect(capped.batchesKept).toBe(2);
      expect(capped.runs).toHaveLength(18);
      expect(capped.runs.every((run) => run.batchRunId !== "batch-c")).toBe(
        true,
      );
    });
  });

  describe("given every selected batch fits within the cap", () => {
    it("keeps every batch", () => {
      const batchRunIds = ["batch-a", "batch-b"];
      const runs = [
        ...makeBatch({ batchRunId: "batch-a", count: 3 }),
        ...makeBatch({ batchRunId: "batch-b", count: 4 }),
      ];

      const capped = capRunsAtBatchBoundary({
        runs,
        batchRunIds,
        ceiling: FULL_MESSAGES_PAGE_LIMIT,
      });

      expect(capped.batchesKept).toBe(2);
      expect(capped.runs).toHaveLength(7);
    });
  });

  describe("given the first batch alone holds more runs than the cap", () => {
    /** @scenario "A single batch larger than the run cap is still served whole" */
    it("serves that batch whole so the cursor still moves", () => {
      const batchRunIds = ["batch-a", "batch-b"];
      const runs = [
        ...makeBatch({ batchRunId: "batch-a", count: 50 }),
        ...makeBatch({ batchRunId: "batch-b", count: 2 }),
      ];

      const capped = capRunsAtBatchBoundary({
        runs,
        batchRunIds,
        ceiling: FULL_MESSAGES_PAGE_LIMIT,
      });

      expect(capped.batchesKept).toBe(1);
      expect(capped.runs).toHaveLength(50);
    });
  });
});
