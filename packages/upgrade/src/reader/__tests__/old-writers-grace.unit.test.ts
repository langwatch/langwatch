/**
 * @vitest-environment node
 * @see specs/upgrade/cloud-automatic.feature
 */
import { describe, expect, it } from "vitest";

import type { UpgradePostgres } from "../../ports.ts";
import type { PreRosterHistory } from "../../serving-roster/pre-roster.ts";
import type { UpgradeImage } from "../reader.schema.ts";
import { createUpgradeReader } from "../reader.service.ts";

const NOW = new Date("2026-11-24T10:00:00.000Z");
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

const image: UpgradeImage = {
  release: "3.28.0",
  steps: [
    {
      id: "trace:backfill-cost",
      kind: "data",
      mode: "background",
      release: "3.28.0",
      needsOldWritersGone: true,
    },
    { id: "trace:fill-names", kind: "data", mode: "background", release: "3.28.0" },
  ],
};

/** A ledger whose run table exists and holds no step rows: every step is one the image declares. */
const ledgerWithRuns: UpgradePostgres = {
  query: async <Row extends object>(text: string) =>
    text.includes("to_regclass") && text.includes('AS "step"')
      ? { rows: [{ step: false, run: true, lease: false, target: false, roster: false } as Row] }
      : { rows: [] },
};

const readerOver = (history: PreRosterHistory) =>
  createUpgradeReader({
    postgres: ledgerWithRuns,
    image,
    preRoster: { findPreRosterHistory: async () => history },
  });

const seededAndUpgraded: PreRosterHistory = {
  now: NOW,
  seededFromExistingAt: minutesAgo(20),
  rollbacksAt: [],
  assertionsAt: [],
  upgradesFinishedAt: [minutesAgo(7)],
};

describe("the upgrade reader on an installation upgraded from a release before the roster", () => {
  describe("when the grace after the upgrade run has not passed", () => {
    /** @scenario "A step held by the grace for writers before the roster reads with the time the grace ends" */
    it("gives a pending step that needs old writers gone the end of the grace, and others none", async () => {
      const { items } = await readerOver(seededAndUpgraded).listSteps();
      const graceOf = (id: string) => items.find((step) => step.id === id)?.oldWritersGraceEndsAt;

      expect(graceOf("trace:backfill-cost")).toBe("2026-11-24T10:23:00.000Z");
      expect(graceOf("trace:fill-names")).toBeNull();
    });

    it("gives the same end on the step's own page", async () => {
      const step = await readerOver(seededAndUpgraded).getStep({ id: "trace:backfill-cost" });
      expect(step.oldWritersGraceEndsAt).toBe("2026-11-24T10:23:00.000Z");
    });
  });

  describe("when old writers before the roster were asserted gone", () => {
    /** @scenario "A step reads no grace once old writers before the roster are asserted gone" */
    it("gives no step a grace", async () => {
      const { items } = await readerOver({
        ...seededAndUpgraded,
        assertionsAt: [minutesAgo(2)],
      }).listSteps();
      expect(items.map((step) => step.oldWritersGraceEndsAt)).toEqual([null, null]);
    });
  });

  describe("when the ledger has no run table yet", () => {
    it("reads no history and gives no step a grace", async () => {
      const reader = createUpgradeReader({
        postgres: { query: async () => ({ rows: [] }) },
        image,
        preRoster: {
          findPreRosterHistory: () => Promise.reject(new Error("read no history")),
        },
      });
      const { items } = await reader.listSteps();
      expect(items.map((step) => step.oldWritersGraceEndsAt)).toEqual([null, null]);
    });
  });
});
