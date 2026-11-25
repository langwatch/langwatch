import { z } from "zod";

import type { UpgradeStep, UpgradeStepStatus } from "../ledger.ts";
import { releaseVersionSchema } from "../manifest/manifest.ts";

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

/** How often a waiting worker or an upgrading api asks the ledger again (UPGRADE-IN-WORKER). */
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
      outcome: "upgrading";
      outstanding: readonly string[];
      refusal: string;
      /** An api whose first install failed shows the token console: nobody can sign in yet. */
      failedRun?: UpgradeFailedRun;
    }>
  | Readonly<{
      admitted: false;
      outcome: "first-install";
      command: typeof UPGRADE_COMMAND;
      refusal: string;
    }>
  | Readonly<{ admitted: false; outcome: "no-clickhouse"; refusal: string }>
  /** No ledger, and this role may not create one (Alex, 2026-10-10, option a). */
  | Readonly<{ admitted: false; outcome: "ledger-not-creatable"; refusal: string }>;

/**
 * Whether this image may serve on this ledger: every blocking step the image declares must be
 * done or not-needed (plan 3.1, Q-U5 1).
 */
export function assertCurrent({
  ledger,
  image,
}: {
  ledger: { steps: readonly Pick<UpgradeStep, "id" | "status">[] };
  image: ServingImage;
}): ServingVerdict {
  const { blockingSteps } = servingImageSchema.parse(image);
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
 * The api never runs a step (UIW-1) and holds for none (NO-HOLDS, Alex 2026-10-09): it serves
 * while upgrading, a Postgres read ahead of the schema answers upgrade_in_progress.
 */
export function apiPhaseVerdict({
  outstanding,
}: {
  outstanding: readonly string[];
}): ServingVerdict {
  const refusal = `the worker's \`${UPGRADE_COMMAND}\` has not finished: ${outstanding.join(", ")}`;
  return { admitted: false, outcome: "upgrading", outstanding, refusal };
}
