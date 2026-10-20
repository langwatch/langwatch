import type { UpgradeRun, UpgradeStep } from "../ledger.ts";
import { compareReleases, SCHEMA_STEP_KINDS } from "../manifest/manifest.ts";
import type { ReleaseManifest } from "../manifest/manifest.ts";

export type InstalledRelease = {
  installed: string | null;
  origin: "recorded" | "inferred" | "none";
};

/**
 * The release the database is on (rethink 6.4): the last succeeded upgrade's release, else the
 * newest manifest settled, as every older one is: schema done, no blocking step failed or running.
 * Settled schema matching no manifest is the release before them all: every step runs from there.
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
  if (recorded?.release) return { installed: recorded.release, origin: "recorded" };

  const settled = new Set(
    steps
      .filter((step) => step.status === "done" || step.status === "not-needed")
      .map((step) => step.id),
  );
  if (settled.size === 0) return { installed: null, origin: "none" };
  const cut = new Set(
    steps.filter((step) => step.status === "failed" || step.status === "running").map((s) => s.id),
  );

  let installed: string | null = null;
  const ordered = manifests.toSorted((left, right) =>
    compareReleases({ left: left.release, right: right.release }),
  );
  for (const manifest of ordered) {
    const schema = manifest.steps.filter((step) => SCHEMA_STEP_KINDS.has(step.kind));
    if (!schema.every((step) => settled.has(step.id))) break;
    if (manifest.steps.some((step) => step.mode === "blocking" && cut.has(step.id))) break;
    installed = manifest.release;
  }
  return { installed: installed ?? ordered[0]?.previous ?? null, origin: "inferred" };
}
