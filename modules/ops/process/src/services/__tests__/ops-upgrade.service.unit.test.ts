/**
 * What ops' upgrade service hands the Upgrades pages: every field the screens read, mapped from
 * UpgradeReader's answers into ops' own shapes, phases included.
 * Spec: modules/ops/specs/upgrades.feature
 */
import {
  opsUpgradeReleasePageSchema,
  opsUpgradeRunPageSchema,
  opsUpgradeRunSchema,
  opsUpgradeStatusSchema,
  opsUpgradeStepDetailSchema,
  opsUpgradeStepPageSchema,
} from "@langwatch/ops-contract";
import type {
  UpgradePreview,
  UpgradeRunDetail,
  UpgradeStepDetail,
} from "@langwatch/upgrade/reader";
import { describe, expect, it } from "vitest";

import { MemoryUpgradeLedgerRepository } from "../../repositories/memory/memory.upgrade-ledger.repository.ts";
import { OpsUpgradeService } from "../ops-upgrade.service.ts";
import { statusOf, stepOf } from "./support/upgrade-ledger.ts";

const AT = "2026-10-06T10:00:00.000Z";
const PLAN: Extract<UpgradePreview["plan"], { outcome: "planned" }> = {
  outcome: "planned",
  fresh: false,
  releases: [],
  notNeeded: [],
};
const STEP = stepOf({
  id: "clickhouse:00042",
  release: "3.23.0",
  lastError: "boom",
  report: { at: 7 },
});
const STEP_DETAIL: UpgradeStepDetail = {
  ...STEP,
  targets: [
    { target: "default", status: "failed", version: null, lastError: "boom", updatedAt: AT },
  ],
};
const RUN_SUMMARY = {
  id: "run_1",
  kind: "upgrade",
  release: "3.23.0",
  floor: "3.20.1",
  startedAt: AT,
  finishedAt: null,
  outcome: null,
};
const RUN: UpgradeRunDetail = {
  ...RUN_SUMMARY,
  plan: { releases: ["3.22.0", "3.23.0"] },
  report: { phases: [] },
  phases: [
    { name: "preflight", release: null, startedAt: AT, finishedAt: AT, outcome: "succeeded" },
    {
      name: "postgres-schema",
      release: "3.22.0",
      startedAt: AT,
      finishedAt: null,
      outcome: "running",
    },
  ],
  steps: [STEP],
};
const STATUS = statusOf({
  lease: {
    name: "upgrade",
    owner: "pod-a",
    image: "3.23.0",
    host: "h",
    heartbeatAt: AT,
    expiresAt: AT,
  },
  lastRun: RUN_SUMMARY,
  counts: { done: 3, failed: 1 },
  failedStepIds: [STEP.id],
  failedTargets: 1,
});

function service() {
  return OpsUpgradeService.create({
    ledger: MemoryUpgradeLedgerRepository.create({
      reader: {
        status: async () => STATUS,
        listReleases: async () => ({
          items: [
            { release: "3.23.0", installed: true, image: true, stepCount: 1, counts: { done: 1 } },
          ],
          cursor: null,
        }),
        listSteps: async () => ({ items: [STEP], cursor: null }),
        getStep: async () => STEP_DETAIL,
        listRuns: async () => ({ items: [RUN_SUMMARY], cursor: "next" }),
        getRun: async () => RUN,
        preflight: async () => [],
        preview: async () => ({ installed: null, plan: PLAN, preflight: [] }),
        listTargets: async () => [],
      },
    }),
  });
}

describe("OpsUpgradeService", () => {
  describe("given a ledger with a release, a failed step and a running run", () => {
    /** @scenario "Upgrade reads answer the reader's shapes unchanged" */
    it("keeps every field the screens read, in ops' own shapes", async () => {
      const upgrades = service();

      expect(opsUpgradeStatusSchema.parse(await upgrades.getStatus())).toEqual(STATUS);
      expect(opsUpgradeReleasePageSchema.parse(await upgrades.listReleases())).toEqual({
        items: [
          { release: "3.23.0", installed: true, image: true, stepCount: 1, counts: { done: 1 } },
        ],
        cursor: null,
      });
      expect(opsUpgradeStepPageSchema.parse(await upgrades.listSteps({}))).toEqual({
        items: [STEP],
        cursor: null,
      });
      expect(opsUpgradeStepDetailSchema.parse(await upgrades.getStep({ id: STEP.id }))).toEqual(
        STEP_DETAIL,
      );
      expect(opsUpgradeRunPageSchema.parse(await upgrades.listRuns({}))).toEqual({
        items: [RUN_SUMMARY],
        cursor: "next",
      });
      expect(opsUpgradeRunSchema.parse(await upgrades.getRun({ id: RUN.id }))).toEqual(RUN);
    });

    /** @scenario "A run's phases are listed in the order they ran" */
    it("keeps a run's phases in the reader's order, an unfinished one included", async () => {
      const run = await service().getRun({ id: RUN.id });

      expect(run.phases.map(({ name, release, outcome }) => [name, release, outcome])).toEqual([
        ["preflight", null, "succeeded"],
        ["postgres-schema", "3.22.0", "running"],
      ]);
    });
  });
});
