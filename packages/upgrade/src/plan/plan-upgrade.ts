import { HandledError } from "@langwatch/handled-error";
import { z } from "zod";

import type { UpgradeStep } from "../ledger.ts";
import { compareReleases, releaseVersionSchema, SCHEMA_STEP_KINDS } from "../manifest/manifest.ts";
import type { ManifestStep, ReleaseManifest } from "../manifest/manifest.ts";

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

export const upgradePlanSchema = z.object({
  outcome: z.literal("planned"),
  fresh: z.boolean(),
  releases: z.array(plannedReleaseSchema),
  notNeeded: z.array(z.string()),
});
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
 * Plans from the ledger and the manifests (rethink 6.4): each release above
 * `installed` or with a schema or blocking step open, then unreleased steps as one virtual one.
 * Specs: specs/upgrade/release-manifests.feature, packages/upgrade/specs/unfinished-steps.feature.
 */
export function planUpgrade({
  installed,
  image,
  manifests,
  ledger,
}: {
  installed: string | null;
  image: { release: string | null; steps: readonly ManifestStep[] };
  manifests: readonly ReleaseManifest[];
  ledger: { steps: readonly Pick<UpgradeStep, "id" | "status">[] };
}): UpgradePlan {
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

  const gating = (step: ManifestStep) =>
    SCHEMA_STEP_KINDS.has(step.kind) || step.mode === "blocking";
  const releases = shipped
    .filter(
      (manifest) =>
        compareReleases({ left: manifest.release, right: installed }) > 0 ||
        open(manifest.steps).some(gating),
    )
    .map((manifest) => plannedRelease({ release: manifest.release, steps: open(manifest.steps) }));
  const pendingUnreleased = open(unreleased);
  if (pendingUnreleased.length > 0) {
    releases.push(plannedRelease({ release: null, steps: pendingUnreleased }));
  }
  return { outcome: "planned", fresh: false, releases, notNeeded: [] };
}

export type StepOrderErrorCode = "step_after_unknown" | "step_after_cycle";

/** An image whose steps name a step it does not have, or name each other in a cycle. */
export class StepOrderError extends HandledError {
  declare readonly code: StepOrderErrorCode;

  constructor({ code, message }: { code: StepOrderErrorCode; message: string }) {
    super(code, message, { httpStatus: 500 });
    this.name = "StepOrderError";
  }
}

type OrderedStep = { id: string; after?: readonly string[] };

/** The ids in declaration order, each after every step it names; refuses unknown ids and cycles. */
export function orderAfter({
  steps,
  settled,
}: {
  steps: readonly OrderedStep[];
  settled: ReadonlySet<string>;
}): string[] {
  const byId = new Map(steps.map((step) => [step.id, step]));
  const ordered: string[] = [];
  const visiting: string[] = [];
  const visit = (id: string) => {
    if (ordered.includes(id)) return;
    if (visiting.includes(id)) {
      const cycle = [...visiting.slice(visiting.indexOf(id)), id].join(" -> ");
      throw new StepOrderError({
        code: "step_after_cycle",
        message: `steps run after each other in a cycle: ${cycle}`,
      });
    }
    visiting.push(id);
    for (const named of byId.get(id)?.after ?? []) {
      if (byId.has(named)) visit(named);
      else if (!settled.has(named)) {
        throw new StepOrderError({
          code: "step_after_unknown",
          message: `step ${id} runs after ${named}, which this image does not declare and the ledger has not settled`,
        });
      }
    }
    visiting.pop();
    ordered.push(id);
  };
  for (const step of steps) visit(step.id);
  return ordered;
}
