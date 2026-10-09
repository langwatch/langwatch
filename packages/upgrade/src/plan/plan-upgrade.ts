import { z } from "zod";

import type { UpgradeStep } from "../ledger.ts";
import { compareReleases, releaseVersionSchema, SCHEMA_STEP_KINDS } from "../manifest/manifest.ts";
import type { LtsFloor, ManifestStep, ReleaseManifest } from "../manifest/manifest.ts";

/** One release the upgrade steps through; the virtual one (no version) holds unreleased steps. */
export const plannedReleaseSchema = z.object({
  release: releaseVersionSchema.nullable(),
  virtual: z.boolean(),
  schema: z.array(z.string()),
  blocking: z.array(z.string()),
  background: z.array(z.string()),
  operator: z.array(z.string()),
});
export type PlannedRelease = z.infer<typeof plannedReleaseSchema>;

export const upgradeRefusalCodeSchema = z.enum(["below_lts_floor", "image_below_ledger_floor"]);
export type UpgradeRefusalCode = z.infer<typeof upgradeRefusalCodeSchema>;

export const upgradePlanSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("planned"),
    fresh: z.boolean(),
    releases: z.array(plannedReleaseSchema),
    notNeeded: z.array(z.string()),
  }),
  z.object({
    outcome: z.literal("refused"),
    code: upgradeRefusalCodeSchema,
    stopAt: releaseVersionSchema.nullable(),
    message: z.string(),
  }),
]);
export type UpgradePlan = z.infer<typeof upgradePlanSchema>;

/** The kinds a fresh install has nothing to move for (rethink 6.4). */
const NOTHING_TO_MOVE_ON_FRESH: ReadonlySet<ManifestStep["kind"]> = new Set([
  "data",
  "tenant",
  "procedure",
]);

function plannedRelease({
  release,
  steps,
}: {
  release: string | null;
  steps: readonly ManifestStep[];
}): PlannedRelease {
  const ids = (keep: (step: ManifestStep) => boolean) =>
    steps.filter((step) => keep(step)).map((step) => step.id);
  const code = (step: ManifestStep) => !SCHEMA_STEP_KINDS.has(step.kind);
  return {
    release,
    virtual: release === null,
    schema: ids((step) => SCHEMA_STEP_KINDS.has(step.kind)),
    blocking: ids((step) => code(step) && step.mode === "blocking"),
    background: ids((step) => code(step) && step.mode === "background"),
    operator: ids((step) => code(step) && step.mode === "operator"),
  };
}

/**
 * Plans an upgrade from the ledger and the shipped manifests (rethink 6.4, blitz 3.2): refusals
 * first, then release by release, then unreleased steps as one virtual release. Settled steps are
 * left out; specs/upgrade/release-manifests.feature is the behaviour.
 */
export function planUpgrade({
  installed,
  image,
  floor,
  manifests,
  ledger,
}: {
  installed: string | null;
  image: { release: string | null; steps: readonly ManifestStep[] };
  floor: LtsFloor;
  manifests: readonly ReleaseManifest[];
  ledger: { floor: string | null; steps: readonly Pick<UpgradeStep, "id" | "status">[] };
}): UpgradePlan {
  if (
    image.release &&
    ledger.floor &&
    compareReleases({ left: image.release, right: ledger.floor }) < 0
  ) {
    return {
      outcome: "refused",
      code: "image_below_ledger_floor",
      stopAt: null,
      message: `this image is ${image.release}; the database was upgraded with LTS floor ${ledger.floor}, so it needs an image of ${ledger.floor} or newer`,
    };
  }
  if (installed && compareReleases({ left: installed, right: floor.release }) < 0) {
    return {
      outcome: "refused",
      code: "below_lts_floor",
      stopAt: floor.release,
      message: `this installation is on ${installed}; upgrade to ${floor.release} (LTS) first, then to this image`,
    };
  }

  const settled = new Set(
    ledger.steps
      .filter((step) => step.status === "done" || step.status === "not-needed")
      .map((step) => step.id),
  );
  const open = (steps: readonly ManifestStep[]) => steps.filter((step) => !settled.has(step.id));
  const shipped = manifests
    .filter(
      (manifest) =>
        image.release === null ||
        compareReleases({ left: manifest.release, right: image.release }) <= 0,
    )
    .toSorted((left, right) => compareReleases({ left: left.release, right: right.release }));
  const released = new Set(manifests.flatMap((manifest) => manifest.steps.map((step) => step.id)));
  const unreleased = image.steps.filter((step) => !released.has(step.id));

  if (installed === null) {
    const every = open([...shipped.flatMap((manifest) => manifest.steps), ...unreleased]);
    const notNeeded = every.filter((step) => NOTHING_TO_MOVE_ON_FRESH.has(step.kind));
    const rest = every.filter((step) => !NOTHING_TO_MOVE_ON_FRESH.has(step.kind));
    return {
      outcome: "planned",
      fresh: true,
      releases: [plannedRelease({ release: image.release, steps: rest })],
      notNeeded: notNeeded.map((step) => step.id),
    };
  }

  const releases = shipped
    .filter((manifest) => compareReleases({ left: manifest.release, right: installed }) > 0)
    .map((manifest) => plannedRelease({ release: manifest.release, steps: open(manifest.steps) }));
  const pendingUnreleased = open(unreleased);
  if (pendingUnreleased.length > 0) {
    releases.push(plannedRelease({ release: null, steps: pendingUnreleased }));
  }
  return { outcome: "planned", fresh: false, releases, notNeeded: [] };
}

/**
 * Before a release whose schema holds a contract step, every unfinished background step shipped in
 * an earlier release runs inline, forced and blocking (Alex, 2026-10-09, UPGRADE-FIXES), so a
 * contract never drops what a background step still reads. Per planned release, the ids to run.
 */
export function inlineBeforeContracts({
  releases,
  contracts,
  background,
  settled,
}: {
  releases: readonly Pick<PlannedRelease, "release" | "schema">[];
  contracts: ReadonlySet<string>;
  background: readonly { id: string; release: string | null }[];
  settled: ReadonlySet<string>;
}): string[][] {
  const earlier = (left: string | null, right: string | null) =>
    left !== null && (right === null || compareReleases({ left, right }) < 0);
  const inlined = new Set<string>();
  return releases.map(({ release, schema }) => {
    if (!schema.some((id) => contracts.has(id))) return [];
    const due = background.filter(
      (step) => !settled.has(step.id) && !inlined.has(step.id) && earlier(step.release, release),
    );
    for (const step of due) inlined.add(step.id);
    return due.map((step) => step.id);
  });
}
