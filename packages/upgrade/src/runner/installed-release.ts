import type { UpgradeRun, UpgradeStep } from "../ledger.ts";
import { compareReleases, SCHEMA_STEP_KINDS } from "../manifest/manifest.ts";
import type { ReleaseManifest } from "../manifest/manifest.ts";

export type InstalledRelease =
  | { known: true; installed: string | null; origin: "recorded" | "inferred" | "none" }
  | { known: false; predates: string | null };

/**
 * The release the database is on (rethink 6.4): the last succeeded upgrade's release, else the
 * newest manifest whose schema, and every older manifest's, the ledger records settled. Settled
 * schema matching no manifest predates them all. Nothing settled is a fresh install.
 */
export function inferInstalledRelease({
  runs,
  steps,
  manifests,
}: {
  runs: readonly Pick<UpgradeRun, "kind" | "outcome" | "release" | "startedAt">[];
  steps: readonly Pick<UpgradeStep, "id" | "status">[];
  manifests: readonly ReleaseManifest[];
}): InstalledRelease {
  const recorded = runs
    .filter((run) => run.kind === "upgrade" && run.outcome === "succeeded" && run.release)
    .toSorted((left, right) => right.startedAt.getTime() - left.startedAt.getTime())[0];
  if (recorded?.release) return { known: true, installed: recorded.release, origin: "recorded" };

  const settled = new Set(
    steps
      .filter((step) => step.status === "done" || step.status === "not-needed")
      .map((step) => step.id),
  );
  if (settled.size === 0) return { known: true, installed: null, origin: "none" };

  let installed: string | null = null;
  const ordered = manifests.toSorted((left, right) =>
    compareReleases({ left: left.release, right: right.release }),
  );
  for (const manifest of ordered) {
    const schema = manifest.steps.filter((step) => SCHEMA_STEP_KINDS.has(step.kind));
    if (!schema.every((step) => settled.has(step.id))) break;
    installed = manifest.release;
  }
  if (installed) return { known: true, installed, origin: "inferred" };
  return { known: false, predates: ordered[0]?.release ?? null };
}

/** The highest LTS floor any upgrade applied with: an image below it must not serve (Q-U5 1). */
export function highestRecordedFloor({
  runs,
}: {
  runs: readonly Pick<UpgradeRun, "floor">[];
}): string | null {
  return runs.reduce<string | null>(
    (highest, run) =>
      run.floor && (!highest || compareReleases({ left: run.floor, right: highest }) > 0)
        ? run.floor
        : highest,
    null,
  );
}
