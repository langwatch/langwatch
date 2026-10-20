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
  opsUpgradeTargetSummarySchema,
} from "@langwatch/ops-contract";
import type {
  UpgradePreview,
  UpgradeRunDetail,
  UpgradeStepDetail,
  UpgradeImageVersion,
  UpgradeTargetSummary,
} from "@langwatch/upgrade/reader";
import { describe, expect, it } from "vitest";

import type { CloudLatestRelease } from "../../repositories/cloud-latest-release.repository.ts";
import { MemoryUpgradeLedgerRepository } from "../../repositories/memory/memory.upgrade-ledger.repository.ts";
import { OpsUpgradeService } from "../ops-upgrade.service.ts";
import { ledgerOf, statusOf, stepOf } from "./support/upgrade-ledger.ts";

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

function service({
  version,
  held,
  targets = [],
  routes,
}: {
  version?: UpgradeImageVersion;
  held?: CloudLatestRelease[];
  targets?: UpgradeTargetSummary[];
  routes?: Parameters<typeof OpsUpgradeService.create>[0]["routes"];
} = {}) {
  return OpsUpgradeService.create({
    isSaas: false,
    ...(routes ? { routes } : {}),
    ...(held ? { cloudReleases: { findLatestRelease: async () => held } } : {}),
    ledger: MemoryUpgradeLedgerRepository.create({
      ...(version ? { version } : {}),
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
        listTargets: async () => targets,
      },
    }),
  });
}

describe("OpsUpgradeService", () => {
  describe("given an image that ships a deprecation without a successor", () => {
    it("adds the register to the status read, a missing successor as null", async () => {
      const upgrades = OpsUpgradeService.create({
        isSaas: false,
        ledger: MemoryUpgradeLedgerRepository.create({
          deprecations: [
            {
              id: "postgres:OldTable",
              what: "Postgres table OldTable",
              kind: "postgres-table",
              deprecatedIn: null,
              removedIn: null,
              notice: "Nothing reads it.",
            },
          ],
        }),
      });

      const { deprecations } = opsUpgradeStatusSchema.parse(await upgrades.getStatus());

      expect(deprecations).toEqual([
        {
          id: "postgres:OldTable",
          what: "Postgres table OldTable",
          kind: "postgres-table",
          deprecatedIn: null,
          removedIn: null,
          successor: null,
          notice: "Nothing reads it.",
        },
      ]);
    });
  });

  describe("given a ledger with a release, a failed step and a running run", () => {
    /** @scenario "Upgrade reads answer the reader's shapes unchanged" */
    it("keeps every field the screens read, in ops' own shapes", async () => {
      const upgrades = service();

      expect(opsUpgradeStatusSchema.parse(await upgrades.getStatus())).toEqual({
        ...STATUS,
        deprecations: [],
        version: { kind: "development", containsRelease: null, commit: null },
        latestRelease: null,
      });
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

describe("OpsUpgradeService.listTargets", () => {
  /** @scenario "The dataplanes tab lists each ClickHouse target with its version, outstanding steps and last error" */
  it("keeps each target's version, outstanding count and last error", async () => {
    const targets = [
      { target: "eu-1", version: "00041", outstanding: 0, lastError: null },
      { target: "us-1", version: "00040", outstanding: 2, lastError: "Code: 241" },
    ];

    const listed = await service({ targets }).listTargets();

    expect(opsUpgradeTargetSummarySchema.array().parse(listed)).toEqual(
      targets.map((target) => ({ ...target, route: "present" })),
    );
  });

  /** @scenario "The dataplanes tab says whether this deployment reaches each private target" */
  it("reads each private target's route as present, missing or malformed", async () => {
    const target = (name: string) => ({
      target: name,
      version: "00041",
      outstanding: 0,
      lastError: null,
    });
    const upgrades = service({
      targets: [
        target("shared"),
        target("private:org_up"),
        target("private:org_gone"),
        target("private:org_broken"),
      ],
      routes: {
        findPrivateRoutes: () => new Map([["org_up", "http://ch-up:8123"]]),
        findPrivateRouteVariables: () => [
          {
            organizationId: "org_up",
            label: "up",
            variable: "CLICKHOUSE_URL__up__org_up",
            state: "present",
          },
          {
            organizationId: "org_broken",
            label: "broken",
            variable: "CLICKHOUSE_URL__broken__org_broken",
            state: "malformed",
          },
        ],
      },
    });

    const routes = (await upgrades.listTargets()).map(({ target, route }) => [target, route]);

    expect(routes).toEqual([
      ["shared", "present"],
      ["private:org_up", "present"],
      ["private:org_gone", "missing"],
      ["private:org_broken", "malformed"],
    ]);
  });
});

describe("OpsUpgradeService.getStatus version and latest release", () => {
  describe("given a release image", () => {
    /** @scenario "The status names a release build by its release" */
    it("names its release", async () => {
      const status = await service({ version: { kind: "release", release: "3.21.0" } }).getStatus();
      expect(status.version).toEqual({ kind: "release", release: "3.21.0" });
    });
  });

  describe("given a development build", () => {
    /** @scenario "The status names a development build by the newest release it contains and its commit" */
    it("names the release it contains and its commit, never unreleased", async () => {
      const version = {
        kind: "development" as const,
        containsRelease: "3.20.1",
        commit: "abc1234",
      };
      const status = await service({ version }).getStatus();
      expect(status.version).toEqual(version);
      expect(JSON.stringify(status)).not.toContain("unreleased");
    });
  });

  describe("given cloud named 3.22.0", () => {
    const held = [{ release: "3.22.0", commit: "def5678" }];

    /** @scenario "The status names cloud's latest release with its notes only when it is newer" */
    it("names it with its notes for an older image, and not for one on it or newer", async () => {
      const older = await service({
        version: { kind: "release", release: "3.21.0" },
        held,
      }).getStatus();
      expect(older.latestRelease).toEqual({
        release: "3.22.0",
        notesUrl: "https://github.com/langwatch/langwatch/releases/tag/langwatch@v3.22.0",
      });
      for (const release of ["3.22.0", "3.23.0"]) {
        const current = await service({ version: { kind: "release", release }, held }).getStatus();
        expect(current.latestRelease).toBeNull();
      }
    });
  });

  describe("given usage reporting is off", () => {
    /** @scenario "No latest release is named when usage reporting is off" */
    it("names none", async () => {
      const status = await service({
        version: { kind: "release", release: "3.21.0" },
        held: [],
      }).getStatus();
      expect(status.latestRelease).toBeNull();
    });
  });
});

describe("OpsUpgradeService.getAttentionNotice", () => {
  const FAILED_STEP = statusOf({
    state: "needs-attention",
    reason: "failed-step",
    failedStepIds: ["clickhouse:00042"],
  });

  function noticeOf({ isSaas, status }: { isSaas: boolean; status: ReturnType<typeof statusOf> }) {
    const reader = { ...ledgerOf([], status) };
    return OpsUpgradeService.create({
      isSaas,
      ledger: MemoryUpgradeLedgerRepository.create({
        reader: {
          ...reader,
          listReleases: async () => ({ items: [], cursor: null }),
          getStep: async () => STEP_DETAIL,
          listRuns: async () => ({ items: [], cursor: null }),
          getRun: async () => RUN,
          preflight: async () => [],
          preview: async () => ({ installed: null, plan: PLAN, preflight: [] }),
          listTargets: async () => [],
        },
      }),
    }).getAttentionNotice();
  }

  describe("given a self-hosted installation with a failed step", () => {
    /** @scenario "A self-hosted installation with a failed step shows members the upgrade notice" */
    it("answers show", async () => {
      await expect(noticeOf({ isSaas: false, status: FAILED_STEP })).resolves.toEqual({
        show: true,
      });
    });
  });

  describe("given a self-hosted installation up to date with only held organizations", () => {
    /** @scenario "Held organizations alone show members no upgrade notice" */
    it("answers do not show", async () => {
      await expect(noticeOf({ isSaas: false, status: statusOf() })).resolves.toEqual({
        show: false,
      });
    });
  });

  describe("given the cloud installation with a failed step", () => {
    /** @scenario "On cloud a failed step shows members no upgrade notice" */
    it("answers do not show", async () => {
      await expect(noticeOf({ isSaas: true, status: FAILED_STEP })).resolves.toEqual({
        show: false,
      });
    });
  });
});
