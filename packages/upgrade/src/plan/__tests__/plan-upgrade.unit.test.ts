import { describe, expect, it } from "vitest";

import type { ManifestStep, ReleaseManifest } from "../../manifest/manifest.ts";
import { planUpgrade } from "../plan-upgrade.ts";

function step(
  id: string,
  kind: ManifestStep["kind"],
  mode: ManifestStep["mode"] = "blocking",
): ManifestStep {
  return { id, kind, mode, owner: null, description: id };
}

function manifest(release: string, previous: string, steps: ManifestStep[]): ReleaseManifest {
  return { release, previous, cutAt: "2026-10-06T12:00:00+02:00", steps };
}

/** Rethink 6.4's worked example: installed 3.20.1, image 3.23.0. */
const manifests = [
  manifest("3.21.0", "3.20.1", [
    step("prisma:20261101000000_add_storage_key", "postgres-schema"),
    step("dataset:copy-keys", "data", "blocking"),
    step("dataset:content-to-object-storage", "data", "background"),
  ]),
  manifest("3.22.0", "3.21.0", [
    step("prisma:20261201000000_add_identifier", "postgres-schema"),
    step("clickhouse:00110", "clickhouse-schema"),
    step("identity:identifier-backfill", "tenant", "background"),
  ]),
  manifest("3.23.0", "3.22.0", [step("prisma:20270101000000_drop_legacy_key", "postgres-schema")]),
];
const imageSteps = manifests.flatMap((release) => release.steps);
const noLedger = { floor: null, steps: [] };

describe("planUpgrade()", () => {
  describe("when 3.20.1 upgrades to a 3.23.0 image over a 3.19.0 floor", () => {
    /** @scenario "An upgrade across several releases steps release by release" */
    it("plans 3.21.0, 3.22.0 and 3.23.0, each from its own manifest", () => {
      expect(
        planUpgrade({
          installed: "3.20.1",
          image: { release: "3.23.0", steps: imageSteps },
          floor: { release: "3.19.0", namedAt: "2026-10-06" },
          manifests: manifests.toReversed(),
          ledger: noLedger,
        }),
      ).toEqual({
        outcome: "planned",
        fresh: false,
        notNeeded: [],
        releases: [
          {
            release: "3.21.0",
            virtual: false,
            schema: ["prisma:20261101000000_add_storage_key"],
            blocking: ["dataset:copy-keys"],
            background: ["dataset:content-to-object-storage"],
            operator: [],
          },
          {
            release: "3.22.0",
            virtual: false,
            schema: ["prisma:20261201000000_add_identifier", "clickhouse:00110"],
            blocking: [],
            background: ["identity:identifier-backfill"],
            operator: [],
          },
          {
            release: "3.23.0",
            virtual: false,
            schema: ["prisma:20270101000000_drop_legacy_key"],
            blocking: [],
            background: [],
            operator: [],
          },
        ],
      });
    });
  });

  describe("when the ledger already records a step of the next release as done", () => {
    /** @scenario "Steps the ledger records as done or not needed are left out of the plan" */
    it("keeps the release and leaves the done step out", () => {
      const plan = planUpgrade({
        installed: "3.22.0",
        image: { release: "3.23.0", steps: imageSteps },
        floor: { release: "3.19.0", namedAt: "2026-10-06" },
        manifests,
        ledger: {
          floor: "3.19.0",
          steps: [{ id: "prisma:20270101000000_drop_legacy_key", status: "done" }],
        },
      });

      expect(plan.outcome === "planned" && plan.releases).toEqual([
        {
          release: "3.23.0",
          virtual: false,
          schema: [],
          blocking: [],
          background: [],
          operator: [],
        },
      ]);
    });
  });

  describe("when the installation is below the LTS floor", () => {
    /** @scenario "An installation below the LTS floor is refused by the name of the LTS to stop at" */
    it("refuses with below_lts_floor and names 3.20.1 as the stop", () => {
      const plan = planUpgrade({
        installed: "3.16.0",
        image: { release: "3.23.0", steps: imageSteps },
        floor: { release: "3.20.1", namedAt: "2026-10-06" },
        manifests,
        ledger: noLedger,
      });

      expect(plan).toMatchObject({ outcome: "refused", code: "below_lts_floor", stopAt: "3.20.1" });
      expect(plan.outcome === "refused" && plan.message).toContain("upgrade to 3.20.1 (LTS) first");
    });
  });

  describe("when the image is older than the floor the ledger records", () => {
    /** @scenario "An image below the ledger's floor is refused" */
    it("refuses with image_below_ledger_floor, naming both releases", () => {
      const plan = planUpgrade({
        installed: "3.22.0",
        image: { release: "3.21.0", steps: imageSteps },
        floor: { release: "3.19.0", namedAt: "2026-10-06" },
        manifests,
        ledger: { floor: "3.22.0", steps: [] },
      });

      expect(plan).toMatchObject({ outcome: "refused", code: "image_below_ledger_floor" });
      expect(plan.outcome === "refused" && plan.message).toMatch(/3\.21\.0.*3\.22\.0/);
    });
  });

  describe("when the database has no installed release", () => {
    /** @scenario "A fresh install applies all schema at once and needs no data, tenant or procedure step" */
    it("plans one release of every schema id and marks every data and tenant step not needed", () => {
      expect(
        planUpgrade({
          installed: null,
          image: { release: "3.23.0", steps: imageSteps },
          floor: { release: "3.19.0", namedAt: "2026-10-06" },
          manifests,
          ledger: noLedger,
        }),
      ).toEqual({
        outcome: "planned",
        fresh: true,
        releases: [
          {
            release: "3.23.0",
            virtual: false,
            schema: [
              "prisma:20261101000000_add_storage_key",
              "prisma:20261201000000_add_identifier",
              "clickhouse:00110",
              "prisma:20270101000000_drop_legacy_key",
            ],
            blocking: [],
            background: [],
            operator: [],
          },
        ],
        notNeeded: [
          "dataset:copy-keys",
          "dataset:content-to-object-storage",
          "identity:identifier-backfill",
        ],
      });
    });
  });

  describe("when a commit-built cloud image declares only unreleased steps", () => {
    /** @scenario "A cloud image with only unreleased steps plans one virtual release" */
    it("plans exactly one virtual release carrying those steps", () => {
      const unreleased = [
        step("prisma:20270201000000_add_flag", "postgres-schema"),
        step("dataset:fill-flag", "data", "background"),
      ];

      expect(
        planUpgrade({
          installed: "3.23.0",
          image: { release: null, steps: [...imageSteps, ...unreleased] },
          floor: { release: "3.19.0", namedAt: "2026-10-06" },
          manifests,
          ledger: { floor: "3.19.0", steps: [] },
        }),
      ).toEqual({
        outcome: "planned",
        fresh: false,
        notNeeded: [],
        releases: [
          {
            release: null,
            virtual: true,
            schema: ["prisma:20270201000000_add_flag"],
            blocking: [],
            background: ["dataset:fill-flag"],
            operator: [],
          },
        ],
      });
    });
  });
});
