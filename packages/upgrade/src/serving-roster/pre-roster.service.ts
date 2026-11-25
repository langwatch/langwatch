import { UpgradeLedgerRepository } from "../ledger.repository.ts";
import type { UpgradePostgres } from "../ports.ts";
import { UpgradeRunnerRepository } from "../runner/runner-ledger.repository.ts";
import { PreRosterRepository } from "./pre-roster.repository.ts";

/** The reason a reopened step carries, so the upgrades page says why it waits again. */
export const PRE_ROSTER_ROLLBACK_REASON =
  "reopened: a rollback to an image before the serving roster was recorded";

/** Every writer before the roster has stopped (the deploy after its rollout, or an operator). */
export async function assertOldWritersGone({
  postgres,
  actor,
}: {
  postgres: UpgradePostgres;
  actor: string;
}) {
  const recordedAt = await PreRosterRepository.create({ postgres }).record({
    kind: "old-writers-gone",
    actor,
  });
  return { recordedAt };
}

/**
 * A rollback to an image before the roster served: hold old-writers steps again, then reopen every
 * done background step, since such an image declares none of them (Round 47 E2). Re-runnable.
 */
export async function recordPreRosterRollback({
  postgres,
  actor,
}: {
  postgres: UpgradePostgres;
  actor: string;
}) {
  const recordedAt = await PreRosterRepository.create({ postgres }).record({
    kind: "pre-roster-rollback",
    actor,
  });
  const steps = await UpgradeLedgerRepository.create({ postgres }).findSteps();
  const ids = steps
    .filter((step) => step.mode === "background" && step.status === "done")
    .map((step) => step.id);
  const reopened = await UpgradeRunnerRepository.create({ postgres }).reopenDoneSteps({
    ids,
    reason: PRE_ROSTER_ROLLBACK_REASON,
  });
  return { recordedAt, reopened };
}
