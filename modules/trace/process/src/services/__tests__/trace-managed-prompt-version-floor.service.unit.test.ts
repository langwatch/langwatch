/**
 * The managed prompt version floor is read from the replay step's ledger row through a read
 * port alone, and answers `unknown` rather than throwing when the ledger cannot be read.
 * @see specs/lwql/stock-widgets-on-trace-metrics.feature
 */
import { describe, expect, it } from "vitest";

import type { SpanAnalyticsFloorRepository } from "../../repositories/span-analytics-floor.repository.ts";
import { TraceManagedPromptVersionFloorService } from "../trace-managed-prompt-version-floor.service.ts";

const SINCE = "2026-07-18T00:00:00Z";
const STARTED = "2026-11-17T10:00:00Z";
const UNKNOWN = { from: null, rebuilding: false, unknown: true };

describe("given the managed prompt version floor", () => {
  describe("when its ledger port is read", () => {
    it("answers from a test double that has no write methods", async () => {
      const readOnly: SpanAnalyticsFloorRepository = {
        findReplayStep: async () => [
          { status: "done", report: { replayedSince: SINCE }, startedAt: STARTED },
        ],
      };

      await expect(
        TraceManagedPromptVersionFloorService.create({ ledger: readOnly }).getFloor(),
      ).resolves.toEqual({ from: SINCE, rebuilding: false, unknown: false });
    });
  });

  describe("when no ledger is composed yet", () => {
    it("answers rebuilding, as a ledger with no row does", async () => {
      await expect(
        TraceManagedPromptVersionFloorService.create({ ledger: null }).getFloor(),
      ).resolves.toEqual({ from: null, rebuilding: true, unknown: false });
    });
  });

  describe("when the ledger read throws", () => {
    /** @scenario "A replay that failed after its retries shows the history as unknown, never the rows" */
    it("answers unknown and does not reject", async () => {
      const unreadable: SpanAnalyticsFloorRepository = {
        findReplayStep: async () => {
          throw new Error("relation upgrade_steps does not exist");
        },
      };

      await expect(
        TraceManagedPromptVersionFloorService.create({ ledger: unreadable }).getFloor(),
      ).resolves.toEqual(UNKNOWN);
    });
  });

  describe("when the ledger row is failed", () => {
    /** @scenario "A replay that failed after its retries shows the history as unknown, never the rows" */
    it("answers unknown", async () => {
      const ledger: SpanAnalyticsFloorRepository = {
        findReplayStep: async () => [
          { status: "failed", report: { replayedSince: SINCE }, startedAt: STARTED },
        ],
      };

      await expect(
        TraceManagedPromptVersionFloorService.create({ ledger }).getFloor(),
      ).resolves.toEqual(UNKNOWN);
    });
  });
});
