import { QUEUE_TENANT_CLAIMS_FILL_STEP } from "@langwatch/upgrade/step";

import type { UpgradeLedgerRepository } from "../repositories/upgrade-ledger.repository.ts";

/** A step the runner left with nothing more to do. */
const SETTLED_STEP_STATUSES: ReadonlySet<string> = new Set(["done", "not-needed"]);

/**
 * Whether an operator replay may trust the queue's claimed-groups index (ADR-092): its backfill is
 * settled in the ledger and every live process lists its claims. A rollback reopens the step.
 */
export class QueueClaimsIndexReadinessService {
  private constructor(
    private readonly ledger: Pick<UpgradeLedgerRepository, "getStep" | "findLiveRoster">,
    private readonly staleAfterMs: number,
  ) {}

  /** `staleAfterMs`: how long a silent process still counts as serving (the roster's timing). */
  static create({
    ledger,
    staleAfterMs,
  }: {
    ledger: Pick<UpgradeLedgerRepository, "getStep" | "findLiveRoster">;
    staleAfterMs: number;
  }): QueueClaimsIndexReadinessService {
    return new QueueClaimsIndexReadinessService(ledger, staleAfterMs);
  }

  async isReady(): Promise<boolean> {
    const [step, roster] = await Promise.all([
      this.ledger.getStep({ id: QUEUE_TENANT_CLAIMS_FILL_STEP }),
      this.ledger.findLiveRoster({ staleAfterMs: this.staleAfterMs }),
    ]);
    return (
      SETTLED_STEP_STATUSES.has(step.status) &&
      roster.every((process) => process.steps.includes(QUEUE_TENANT_CLAIMS_FILL_STEP))
    );
  }
}
