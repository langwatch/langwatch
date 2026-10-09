import { z } from "zod";

import type { UpgradeRun, UpgradeStep, UpgradeStepStatus } from "../ledger.ts";
import { compareReleases, releaseVersionSchema } from "../manifest/manifest.ts";

/** What a refusal tells the operator to run (rethink 6.7). */
export const UPGRADE_COMMAND = "pnpm task upgrade";

/** The roles the gate guards; tasks runs `upgrade` and is never gated (plan D5). */
export const servingRoleSchema = z.enum(["api", "worker"]);
export type ServingRole = z.infer<typeof servingRoleSchema>;

/** A serving image: its release (none on a `git-<sha>` build) and its blocking steps. */
export const servingImageSchema = z.object({
  release: releaseVersionSchema.nullable(),
  blockingSteps: z.array(z.string().min(1)),
});
export type ServingImage = z.infer<typeof servingImageSchema>;

const SETTLED: ReadonlySet<UpgradeStepStatus> = new Set(["done", "not-needed"]);

/** How often a waiting worker or a holding api asks the ledger again (UPGRADE-IN-WORKER). */
export const UPGRADE_RE_ASK_MS = 10_000;

/** A failed `upgrade` run, for the api's console: the failed steps and the run's last lines. */
export type UpgradeFailedRun = Readonly<{
  failedSteps: readonly Readonly<{ id: string; error: string | null }>[];
  logTail: readonly string[];
}>;

export type ServingVerdict =
  | Readonly<{ admitted: true; outcome: "current" }>
  | Readonly<{
      admitted: false;
      outcome: "behind";
      outstanding: readonly string[];
      command: typeof UPGRADE_COMMAND;
      refusal: string;
    }>
  | Readonly<{
      admitted: false;
      outcome: "holding" | "upgrading";
      outstanding: readonly string[];
      refusal: string;
    }>
  | Readonly<{
      admitted: false;
      outcome: "below-floor";
      release: string;
      floor: string;
      refusal: string;
    }>
  | Readonly<{
      admitted: false;
      outcome: "first-install";
      command: typeof UPGRADE_COMMAND;
      refusal: string;
    }>
  | Readonly<{ admitted: false; outcome: "no-clickhouse"; refusal: string }>;

/** The highest floor any upgrade run recorded, or null when none did (plan 3.2). */
export function ledgerFloor({
  runs,
}: {
  runs: readonly Pick<UpgradeRun, "floor">[];
}): string | null {
  let highest: string | null = null;
  for (const { floor } of runs) {
    if (floor === null) continue;
    if (highest === null || compareReleases({ left: floor, right: highest }) > 0) highest = floor;
  }
  return highest;
}

/**
 * Whether this image may serve on this ledger: a release below the floor refuses first, then
 * every blocking step the image declares must be done or not-needed (plan 3.1, Q-U5 1). An
 * unreleased build is newer than every release, so it is never below a floor.
 */
export function assertCurrent({
  ledger,
  image,
  floor,
}: {
  ledger: { steps: readonly Pick<UpgradeStep, "id" | "status">[] };
  image: ServingImage;
  floor: string | null;
}): ServingVerdict {
  const { release, blockingSteps } = servingImageSchema.parse(image);
  if (release !== null && floor !== null && compareReleases({ left: release, right: floor }) < 0) {
    return {
      admitted: false,
      outcome: "below-floor",
      release,
      floor,
      refusal:
        `release ${release} is below the installation's floor ${floor}: an upgrade at that floor ` +
        `may have removed what this release reads; run release ${floor} or newer.`,
    };
  }
  const status = new Map(ledger.steps.map((step) => [step.id, step.status]));
  const outstanding = blockingSteps.filter((id) => {
    const recorded = status.get(id);
    return recorded === undefined || !SETTLED.has(recorded);
  });
  if (outstanding.length === 0) return { admitted: true, outcome: "current" };
  return {
    admitted: false,
    outcome: "behind",
    outstanding,
    command: UPGRADE_COMMAND,
    refusal:
      `the installation is behind this image: blocking steps not done: ${outstanding.join(", ")}. ` +
      `Run \`${UPGRADE_COMMAND}\` from this image, then start it again.`,
  };
}

/** Q10: a first install is an empty ledger on an empty schema; the worker runs `upgrade` once. */
export function firstInstallVerdict(): ServingVerdict {
  return {
    admitted: false,
    outcome: "first-install",
    command: UPGRADE_COMMAND,
    refusal: `this is a first install (empty ledger, empty schema): run \`${UPGRADE_COMMAND}\` once.`,
  };
}

/**
 * The api never runs a step (UIW-1): it holds while a Postgres schema step of its image is
 * outstanding (step id grammar, blitz plan 5.3: `prisma:<folder>`), then upgrades until current.
 */
export function apiPhaseVerdict({
  outstanding,
}: {
  outstanding: readonly string[];
}): ServingVerdict {
  const schema = outstanding.filter((id) => id.startsWith("prisma:"));
  const left = schema.length > 0 ? schema : outstanding;
  const refusal = `the worker's \`${UPGRADE_COMMAND}\` has not finished: ${left.join(", ")}`;
  return schema.length > 0
    ? { admitted: false, outcome: "holding", outstanding: schema, refusal }
    : { admitted: false, outcome: "upgrading", outstanding, refusal };
}
