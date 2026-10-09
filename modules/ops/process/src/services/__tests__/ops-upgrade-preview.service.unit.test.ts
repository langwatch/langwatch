/**
 * The preview and dataplane reads: the reader's plan narrowing and preflight, mapped into ops'
 * shapes. Spec: modules/ops/specs/upgrades.feature
 */
import { opsUpgradePreviewSchema, opsUpgradeTargetSummarySchema } from "@langwatch/ops-contract";
import {
  createUpgradeReader,
  preflightFrom,
  previewUpgradeTo,
  type UpgradePreview,
  type UpgradeStatus,
  type UpgradeTargetSummary,
} from "@langwatch/upgrade/reader";
import { describe, expect, it } from "vitest";

import { MemoryUpgradeLedgerRepository } from "../../repositories/memory/memory.upgrade-ledger.repository.ts";
import { OpsUpgradeService } from "../ops-upgrade.service.ts";
import { statusOf } from "./support/upgrade-ledger.ts";

const IMAGE = { release: "3.23.0" };

function releaseOf(release: string) {
  return {
    release,
    virtual: false,
    schema: [`postgres:${release}-schema`],
    blocking: [`ops:${release}-blocking`],
    background: [`ops:${release}-background`],
    operator: [`ops:${release}-operator`],
  };
}

const PLAN: Extract<UpgradePreview["plan"], { outcome: "planned" }> = {
  outcome: "planned",
  fresh: false,
  releases: [releaseOf("3.22.0"), releaseOf("3.23.0")],
  notNeeded: [],
};

function service({
  status = statusOf(),
  targets = [],
}: { status?: UpgradeStatus; targets?: UpgradeTargetSummary[] } = {}) {
  const reader = createUpgradeReader({
    postgres: { query: async () => ({ rows: [] }) },
    image: { release: IMAGE.release, steps: [] },
    floor: null,
  });
  return OpsUpgradeService.create({
    ledger: MemoryUpgradeLedgerRepository.create({
      reader: {
        ...reader,
        preview: async ({ to }) => ({
          installed: "3.21.0",
          plan: previewUpgradeTo({ plan: PLAN, image: IMAGE, to }),
          preflight: preflightFrom({ status }),
        }),
        listTargets: async () => targets,
      },
    }),
  });
}

describe("OpsUpgradeService preview", () => {
  /** @scenario "The preview lists the steps up to the release asked for, release by release" */
  it("lists each release up to the target with its steps by phase", async () => {
    const preview = opsUpgradePreviewSchema.parse(await service().preview({ to: "3.22.0" }));

    expect(preview.plan).toEqual({
      outcome: "planned",
      fresh: false,
      releases: [releaseOf("3.22.0")],
      notNeeded: [],
    });
  });

  /** @scenario "The preview shows the preflight rows the CLI prints" */
  it("refuses the failed step, verifies the lease and leaves the backup unchecked", async () => {
    const status = statusOf({ failedStepIds: ["clickhouse:00042"], lease: null });
    const { preflight } = await service({ status }).preview({ to: IMAGE.release });
    const row = (name: string) => preflight.find((each) => each.name === name);

    expect(row("No failed step")).toMatchObject({
      outcome: "refused",
      detail: "clickhouse:00042",
    });
    expect(row("No upgrade in progress")).toMatchObject({ outcome: "verified" });
    expect(row("Recent backup")).toMatchObject({ outcome: "unchecked" });
    expect(row("Recent backup")?.fix).toBeTruthy();
  });

  /** @scenario "A target newer than the image is refused with the command that previews from that image" */
  it("refuses a target newer than the image with the target image's command", async () => {
    const { plan } = await service().preview({ to: "3.24.0" });

    expect(plan).toMatchObject({ outcome: "refused", code: "target_not_in_image" });
    expect(plan.outcome === "refused" && plan.message).toContain("upgrade plan --to 3.24.0");
  });
});

describe("OpsUpgradeService listTargets", () => {
  /** @scenario "The dataplanes tab lists each ClickHouse target with its version, outstanding steps and last error" */
  it("keeps each target's version, outstanding count and last error", async () => {
    const targets = [
      { target: "eu-1", version: "00041", outstanding: 0, lastError: null },
      { target: "us-1", version: "00040", outstanding: 2, lastError: "Code: 241" },
    ];

    const listed = await service({ targets }).listTargets();

    expect(opsUpgradeTargetSummarySchema.array().parse(listed)).toEqual(targets);
  });
});
