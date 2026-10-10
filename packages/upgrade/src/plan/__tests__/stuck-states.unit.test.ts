/** @see specs/upgrade/upgrade-stuck-states-planner.feature */
import { describe, expect, it } from "vitest";

import type { UpgradeStep } from "../../ledger.ts";
import type { ManifestStep, ReleaseManifest } from "../../manifest/manifest.ts";
import { planInstallation } from "../plan-installation.ts";

const step = (id: string, kind: ManifestStep["kind"] = "postgres-schema"): ManifestStep => ({
  id,
  kind,
  mode: "blocking",
  owner: null,
  description: id,
});
const manifest = (release: string, previous: string, steps: ManifestStep[]): ReleaseManifest => ({
  release,
  previous,
  cutAt: "2026-10-06T12:00:00+02:00",
  steps,
});
const manifests = [
  manifest("3.21.0", "3.20.1", [step("prisma:20261101000000_a")]),
  manifest("3.22.0", "3.21.0", [
    step("prisma:20261201000000_b"),
    step("dataset:copy-keys", "data"),
  ]),
  manifest("3.23.0", "3.22.0", [step("prisma:20270101000000_c")]),
];
const planning = {
  image: { release: "3.23.0", steps: manifests.flatMap((release) => release.steps) },
  releases: { manifests, floor: { release: "3.21.0", namedAt: "2026-10-01" } },
};
const at = new Date("2026-10-07T00:00:00Z");
const seed = { kind: "seed" as const, outcome: "succeeded" as const, release: null, floor: null };
const failedUpgrade = ({ fresh }: { fresh: boolean }) => ({
  kind: "upgrade" as const,
  outcome: "failed" as const,
  release: "3.23.0",
  floor: "3.21.0",
  startedAt: at,
  plan: { outcome: "planned", fresh, releases: [], notNeeded: [] },
});
const ledger = (entries: Record<string, UpgradeStep["status"]>) =>
  Object.entries(entries).map(([id, status]) => ({ id, status }));
const plannedReleases = (plan: ReturnType<typeof planInstallation>["plan"]) =>
  plan.outcome === "planned" ? plan.releases : [];

describe("planInstallation() on a stuck ledger", () => {
  describe("when a first install failed after recording some schema below the floor", () => {
    /** @scenario "A partial first install resumes as a fresh install instead of refusing below the floor" */
    it("plans the rest as a fresh install, not a refusal", () => {
      const { installed, plan } = planInstallation({
        ...planning,
        steps: ledger({ "prisma:20200101000000_ancient": "done" }),
        runs: [{ ...seed, startedAt: at }, failedUpgrade({ fresh: true })],
      });
      expect(installed).toBeNull();
      expect(plan).toMatchObject({ outcome: "planned", fresh: true });
      expect(plannedReleases(plan)[0]?.schema).toContain("prisma:20261101000000_a");
    });
  });

  describe("when an installation that never ran a fresh plan records schema no manifest names", () => {
    /** @scenario "Settled schema that no fresh run applied still refuses below the floor" */
    it("still refuses below the LTS floor", () => {
      const { plan } = planInstallation({
        ...planning,
        steps: ledger({ "prisma:20200101000000_ancient": "done" }),
        runs: [{ ...seed, startedAt: at }, failedUpgrade({ fresh: false })],
      });
      expect(plan).toMatchObject({ outcome: "refused", code: "below_lts_floor" });
    });
  });

  describe("when a release's schema is settled but its blocking step failed or was cut", () => {
    /** @scenario "A released blocking step left unfinished runs on the next upgrade" */
    it.each(["failed", "running"] as const)(
      "plans that release again with the %s step",
      (status) => {
        const { installed, plan } = planInstallation({
          ...planning,
          steps: ledger({
            "prisma:20261101000000_a": "done",
            "prisma:20261201000000_b": "done",
            "dataset:copy-keys": status,
          }),
          runs: [{ ...seed, startedAt: at }, failedUpgrade({ fresh: false })],
        });
        expect(installed).toBe("3.21.0");
        expect(
          plannedReleases(plan).map(({ release, blocking }) => ({ release, blocking })),
        ).toEqual([
          { release: "3.22.0", blocking: ["dataset:copy-keys"] },
          { release: "3.23.0", blocking: [] },
        ]);
      },
    );
  });

  describe("when a release's blocking step was never attempted", () => {
    /** @scenario "A blocking step no run attempted does not lower the inferred release" */
    it("infers the release from its schema alone", () => {
      const { installed } = planInstallation({
        ...planning,
        steps: ledger({
          "prisma:20261101000000_a": "done",
          "prisma:20261201000000_b": "done",
          "dataset:copy-keys": "pending",
        }),
        runs: [{ ...seed, startedAt: at }],
      });
      expect(installed).toBe("3.22.0");
    });
  });
});
