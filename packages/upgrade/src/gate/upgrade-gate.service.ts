import type { UpgradeRun, UpgradeStep } from "../ledger.ts";
import type { ServingRoster } from "../serving-roster/index.ts";
import {
  detectRollbacks,
  type RollbackLedgerRun,
  type RollbackLedgerStep,
  rollbackReason,
} from "../serving-roster/rollback.ts";
import {
  assertCurrent,
  firstInstallVerdict,
  ledgerFloor,
  servingImageSchema,
  servingRoleSchema,
  type ServingImage,
  type ServingRole,
  type ServingVerdict,
} from "./serving-gate.ts";

/** What the gate reads; `UpgradeLedgerRepository` answers it as it stands. */
export interface ServingGateLedger {
  findSteps(): Promise<readonly (Pick<UpgradeStep, "id" | "status"> & RollbackLedgerStep)[]>;
  findRuns(): Promise<readonly (Pick<UpgradeRun, "floor"> & RollbackLedgerRun)[]>;
}

/** Reopens done steps and answers the ids it reopened; `onError` hears a reopen that failed. */
export interface ServingGateRollback {
  reopen(input: { ids: readonly string[]; reason: string }): Promise<string[]>;
  onReopened?: (input: { ids: readonly string[]; reason: string }) => void;
  onError?: (error: unknown) => void;
}

export type ServingGateImage = ServingImage & {
  /** What the serving roster names the build by: its release, or `git-<sha>` on cloud. */
  name: string;
  /** The background and tenant step ids the serving roster declares (plan 3.1, D2). */
  declaredSteps: readonly string[];
};

export interface UpgradeGate {
  admit(): Promise<ServingVerdict>;
  release(): Promise<void>;
  /** Admitted and not released; a failing roster write never changes it (Alex, 2026-10-09). */
  serving(): boolean;
}

/**
 * One serving process's gate (plan D5): `admit` reads the ledger, refuses by name when behind or
 * below the floor, and records its roster entry only once admitted; `release` removes it at a
 * graceful stop. Spec: specs/upgrade/serving-gate.feature.
 */
export function createUpgradeGate({
  role,
  processId,
  image,
  ledger,
  roster,
  schemaIsEmpty,
  rollback,
}: {
  role: ServingRole;
  processId: string;
  image: ServingGateImage;
  ledger: ServingGateLedger;
  roster: ServingRoster;
  /** True when the application schema holds nothing yet (Q10's first install). */
  schemaIsEmpty: () => Promise<boolean>;
  /** Round 9 (S3-ROLLBACK): absent, an admitted process reopens nothing. */
  rollback?: ServingGateRollback;
}): UpgradeGate {
  const gatedRole = servingRoleSchema.parse(role);
  const { release, blockingSteps } = servingImageSchema.parse(image);
  let admitted = false;
  return {
    async admit() {
      const [steps, runs] = await Promise.all([ledger.findSteps(), ledger.findRuns()]);
      const verdict = assertCurrent({
        ledger: { steps },
        image: { release, blockingSteps },
        floor: ledgerFloor({ runs }),
      });
      if (!verdict.admitted) {
        const empty = steps.length === 0 && runs.length === 0;
        if (gatedRole === "api" && empty && (await schemaIsEmpty())) return firstInstallVerdict();
        return verdict;
      }
      await roster.record({
        processId,
        role: gatedRole,
        image: image.name,
        release,
        steps: [...image.declaredSteps],
      });
      admitted = true;
      if (rollback) await reopenAfterRollback({ ledger, roster, rollback });
      return verdict;
    },
    async release() {
      admitted = false;
      await roster.stop();
    },
    serving: () => admitted,
  };
}

/** A reopen never refuses a start: the failure is reported; the next admitted process retries. */
async function reopenAfterRollback({
  ledger,
  roster,
  rollback,
}: {
  ledger: ServingGateLedger;
  roster: ServingRoster;
  rollback: ServingGateRollback;
}): Promise<void> {
  try {
    const [steps, runs, live] = await Promise.all([
      ledger.findSteps(),
      ledger.findRuns(),
      roster.live(),
    ]);
    for (const sighting of detectRollbacks({ runs, steps, live })) {
      const reason = rollbackReason({ sighting });
      const ids = await rollback.reopen({ ids: sighting.stepIds, reason });
      if (ids.length > 0) rollback.onReopened?.({ ids, reason });
    }
  } catch (error) {
    rollback.onError?.(error);
  }
}
