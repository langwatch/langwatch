/**
 * @see specs/upgrade/release-manifests.feature
 * @see specs/upgrade/upgrade-reader.feature
 */
import { describe, expect, it } from "vitest";

import type { UpgradePlan } from "../../plan/plan-upgrade.ts";
import { preflightFrom } from "../preflight.ts";
import { previewUpgradeTo } from "../preview.ts";
import type { UpgradeStatus } from "../reader.schema.ts";

function release(version: string | null) {
  const ids = [`prisma:${version ?? "unreleased"}`];
  return {
    release: version,
    virtual: version === null,
    schema: ids,
    blocking: [],
    background: [],
    operator: [],
  };
}

const plan: UpgradePlan = {
  outcome: "planned",
  fresh: false,
  releases: [release("3.21.0"), release("3.22.0"), release("3.23.0")],
  notNeeded: [],
};

function status(overrides: Partial<UpgradeStatus> = {}): UpgradeStatus {
  return {
    state: "up-to-date",
    label: "Up to date",
    tone: "neutral",
    reason: "current",
    summary: "Release 3.21.0 is current.",
    installed: "3.21.0",
    origin: "recorded",
    image: "3.21.0",
    lease: null,
    lastRun: null,
    counts: { done: 4 },
    failedStepIds: [],
    failedTargets: 0,
    ...overrides,
  };
}

describe("previewUpgradeTo()", () => {
  describe("when 3.20.1 previews a 3.23.0 image's upgrade to 3.22.0", () => {
    /** @scenario "A preview to a target release stops at that release" */
    it("keeps 3.21.0 and 3.22.0 and drops 3.23.0", () => {
      const preview = previewUpgradeTo({ plan, image: { release: "3.23.0" }, to: "3.22.0" });
      expect(preview).toMatchObject({ outcome: "planned" });
      expect(preview.outcome === "planned" && preview.releases.map((r) => r.release)).toEqual([
        "3.21.0",
        "3.22.0",
      ]);
    });
  });

  describe("when the target is newer than the image", () => {
    /** @scenario "A preview to a release this image does not ship prints the command that previews from the target image" */
    it("refuses with target_not_in_image and names the command to run from the target image", () => {
      const preview = previewUpgradeTo({ plan, image: { release: "3.23.0" }, to: "3.24.0" });
      expect(preview).toMatchObject({
        outcome: "refused",
        code: "target_not_in_image",
        stopAt: "3.24.0",
      });
      expect(preview.outcome === "refused" && preview.message).toContain(
        "`pnpm task upgrade plan --to 3.24.0` from the 3.24.0 image",
      );
    });
  });
});

describe("preflightFrom()", () => {
  describe("when a step failed and a lease is held", () => {
    /** @scenario "The preflight refuses a failed step and a live lease, naming each fix" */
    it("refuses the failed-step and lease rows, each with a fix", () => {
      const rows = preflightFrom({
        status: status({
          state: "needs-attention",
          reason: "failed-step",
          installed: "3.16.0",
          failedStepIds: ["dataset:copy-keys"],
          lease: {
            name: "upgrade",
            owner: "runner-1",
            image: "3.21.0",
            host: "pod-a",
            heartbeatAt: null,
            expiresAt: null,
          },
        }),
      });
      const refused = rows.filter((row) => row.outcome === "refused");
      expect(refused.map((row) => row.id)).toEqual(["failed-steps", "lease"]);
      for (const row of refused) expect(row.fix).toBeTruthy();
      expect(refused[0]?.detail).toContain("dataset:copy-keys");
    });
  });

  describe("when the installation is up to date", () => {
    /** @scenario "The preflight of a current installation is verified except the backup, which is always unchecked" */
    it("verifies every row but the backup, which is unchecked and names the upgrade docs", () => {
      const rows = preflightFrom({ status: status() });
      expect(rows.map((row) => [row.id, row.outcome])).toEqual([
        ["failed-steps", "verified"],
        ["lease", "verified"],
        ["backup", "unchecked"],
      ]);
      expect(rows.at(-1)?.docsPath).toBe("/self-hosting/upgrade");
    });
  });
});

describe("previewUpgradeTo() from an unreleased image", () => {
  const manifests = [{ release: "3.22.0" }, { release: "3.23.0" }, { release: "3.21.0" }];

  describe("when the target is newer than the newest manifest the image ships", () => {
    /** @scenario "An unreleased image refuses a preview to a release newer than its newest manifest" */
    it("refuses with the command that previews from the target image", () => {
      const preview = previewUpgradeTo({ plan, image: { release: null }, manifests, to: "3.24.0" });
      expect(preview).toMatchObject({
        outcome: "refused",
        code: "target_not_in_image",
        stopAt: "3.24.0",
      });
      expect(preview.outcome === "refused" && preview.message).toContain(
        "this image is unreleased and ships no manifest for 3.24.0",
      );
    });
  });

  describe("when the target is a manifest the image ships", () => {
    /** @scenario "An unreleased image previews to a release it ships a manifest for" */
    it("narrows the plan to that release", () => {
      const preview = previewUpgradeTo({ plan, image: { release: null }, manifests, to: "3.22.0" });
      expect(preview.outcome === "planned" && preview.releases.map((r) => r.release)).toEqual([
        "3.21.0",
        "3.22.0",
      ]);
    });
  });
});
