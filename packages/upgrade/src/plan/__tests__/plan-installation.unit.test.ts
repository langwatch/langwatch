/** @see specs/upgrade/upgrade-reader.feature */
import { describe, expect, it } from "vitest";

import type { ManifestStep, ReleaseManifest } from "../../manifest/manifest.ts";
import { planInstallation } from "../plan-installation.ts";

const step = (id: string): ManifestStep => ({
  id,
  kind: "postgres-schema",
  mode: "blocking",
  owner: null,
  description: id,
});
const manifest = (release: string, previous: string, id: string): ReleaseManifest => ({
  release,
  previous,
  cutAt: "2026-10-06T12:00:00+02:00",
  steps: [step(id)],
});
const manifests = [
  manifest("3.21.0", "3.20.1", "prisma:20261101000000_a"),
  manifest("3.22.0", "3.21.0", "prisma:20261201000000_b"),
];
const planning = {
  image: { release: "3.22.0", steps: manifests.flatMap((release) => release.steps) },
  releases: { manifests, floor: { release: "3.21.0", namedAt: "2026-10-01" } },
};
const upgradeTo = (release: string) => ({
  kind: "upgrade" as const,
  outcome: "succeeded" as const,
  release,
  floor: "3.21.0",
  startedAt: new Date("2026-10-07T00:00:00Z"),
});

describe("planInstallation()", () => {
  describe("when the last succeeded upgrade recorded 3.21.0", () => {
    it("plans 3.22.0 from installed 3.21.0", () => {
      const { installed, plan } = planInstallation({
        ...planning,
        steps: [{ id: "prisma:20261101000000_a", status: "done" }],
        runs: [upgradeTo("3.21.0")],
      });
      expect(installed).toBe("3.21.0");
      expect(plan.outcome === "planned" && plan.releases.map((r) => r.release)).toEqual(["3.22.0"]);
    });
  });

  describe("when the ledger records settled schema no manifest names", () => {
    it("refuses below the LTS floor", () => {
      const { installed, plan } = planInstallation({
        ...planning,
        steps: [{ id: "prisma:20200101000000_ancient", status: "done" }],
        runs: [],
      });
      expect(installed).toBeNull();
      expect(plan).toMatchObject({ outcome: "refused", code: "below_lts_floor", stopAt: "3.21.0" });
    });
  });

  describe("when the runner applied everything itself on a fresh database", () => {
    it("reads the installation as fresh, with nothing installed", () => {
      const { installed } = planInstallation({
        ...planning,
        steps: [{ id: "prisma:20261101000000_a", status: "done" }],
        runs: [],
        fresh: true,
      });
      expect(installed).toBeNull();
    });
  });
});
