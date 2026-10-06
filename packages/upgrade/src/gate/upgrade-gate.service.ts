import type { UpgradeRun, UpgradeStep } from "../ledger.ts";
import type { Presence } from "../presence/index.ts";
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
  findSteps(): Promise<readonly Pick<UpgradeStep, "id" | "status">[]>;
  findRuns(): Promise<readonly Pick<UpgradeRun, "floor">[]>;
}

export type ServingGateImage = ServingImage & {
  /** What presence names the build by: its release, or `git-<sha>` on cloud. */
  name: string;
  /** The background and tenant step ids presence declares (plan 3.1, D2). */
  declaredSteps: readonly string[];
};

export interface UpgradeGate {
  admit(): Promise<ServingVerdict>;
  release(): Promise<void>;
}

/**
 * One serving process's gate (plan D5): `admit` reads the ledger, refuses by name when behind or
 * below the floor, and records presence only once admitted; `release` removes it at a graceful
 * stop. Spec: specs/upgrade/serving-gate.feature.
 */
export function createUpgradeGate({
  role,
  processId,
  image,
  ledger,
  presence,
  schemaIsEmpty,
}: {
  role: ServingRole;
  processId: string;
  image: ServingGateImage;
  ledger: ServingGateLedger;
  presence: Presence;
  /** True when the application schema holds nothing yet (Q10's first install). */
  schemaIsEmpty: () => Promise<boolean>;
}): UpgradeGate {
  const gatedRole = servingRoleSchema.parse(role);
  const { release, blockingSteps } = servingImageSchema.parse(image);
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
      await presence.record({
        processId,
        role: gatedRole,
        image: image.name,
        release,
        steps: [...image.declaredSteps],
      });
      return verdict;
    },
    release: () => presence.stop(),
  };
}
