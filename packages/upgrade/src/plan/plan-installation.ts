import type { UpgradeRun, UpgradeStep } from "../ledger.ts";
import type { ManifestStep, ReleaseManifest } from "../manifest/manifest.ts";
import { inferInstalledRelease } from "../runner/installed-release.ts";
import { planUpgrade, upgradePlanSchema, type UpgradePlan } from "./plan-upgrade.ts";

/** What planning needs beside the ledger: the image and every release manifest it carries. */
export interface UpgradePlanning {
  image: { release: string | null; steps: readonly ManifestStep[] };
  releases: { manifests: readonly ReleaseManifest[] };
}

/**
 * The plan for this installation, shared by `upgrade plan` and the reader's preview (U6-U9-READER).
 * `fresh`: the runner found no Prisma history, so what the ledger holds it applied itself. Until an
 * upgrade succeeds, a run that planned fresh keeps it fresh: a cut first install resumes.
 */
export function planInstallation({
  image,
  releases,
  steps,
  runs,
  fresh = false,
}: UpgradePlanning & {
  steps: readonly Pick<UpgradeStep, "id" | "status">[];
  runs: readonly (Pick<UpgradeRun, "kind" | "outcome" | "release" | "startedAt"> &
    Partial<Pick<UpgradeRun, "plan">>)[];
  fresh?: boolean;
}): { installed: string | null; plan: UpgradePlan } {
  const upgrades = runs.filter((run) => run.kind === "upgrade");
  const plannedFresh = (plan: unknown) => {
    const parsed = upgradePlanSchema.safeParse(plan);
    return parsed.success && parsed.data.outcome === "planned" && parsed.data.fresh;
  };
  const resumesFresh =
    upgrades.some((run) => plannedFresh(run.plan)) &&
    !upgrades.some((run) => run.outcome === "succeeded");
  const installed =
    (fresh && upgrades.length === 0) || resumesFresh
      ? null
      : inferInstalledRelease({ runs, steps, manifests: releases.manifests }).installed;
  const plan = planUpgrade({ installed, image, manifests: releases.manifests, ledger: { steps } });
  return { installed, plan };
}
