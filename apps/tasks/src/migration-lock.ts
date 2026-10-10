import { randomUUID } from "node:crypto";
import { hostname } from "node:os";

import { createLogger } from "@langwatch/observability";
import { type UpgradePostgres, UpgradeLedgerRepository } from "@langwatch/upgrade";
import {
  DEFAULT_LEASE_TIMING,
  holdUpgradeLease,
  type UpgradeLeaseTiming,
  UpgradeRunnerRepository,
} from "@langwatch/upgrade/runner";

/** What the legacy tasks call themselves on the lease, so `upgrade` can say who holds it. */
export const LEGACY_TASKS_IMAGE = "pnpm task (legacy tasks)";

type LeaseLedger = Pick<UpgradeLedgerRepository, "acquireLease" | "renewLease" | "releaseLease">;

/**
 * Runs the legacy tasks under the one timed upgrade lease, so they and `upgrade` never overlap
 * (dev/docs/ARCHITECTURE.md, "No stuck states"): waits for a live holder as `upgrade` does, then
 * refuses naming it.
 */
export async function holdTasksLease({
  ledger,
  runner,
  run,
  timing = DEFAULT_LEASE_TIMING,
  host = hostname(),
}: {
  ledger: LeaseLedger;
  runner: Pick<UpgradeRunnerRepository, "findLease">;
  run: () => Promise<void>;
  timing?: UpgradeLeaseTiming;
  host?: string;
}): Promise<void> {
  const logger = createLogger("langwatch:tasks");
  const held = await holdUpgradeLease({
    ledger,
    runner,
    identity: { owner: `${host}:${randomUUID()}`, image: LEGACY_TASKS_IMAGE, host },
    timing,
    log: {
      info: (message, fields) => logger.info(fields ?? {}, message),
      warn: (message, fields) => logger.warn(fields ?? {}, message),
    },
    signal: new AbortController().signal,
    work: run,
  });
  if (!held.acquired) {
    const holder = held.holder
      ? `${held.holder.owner} on ${held.holder.host} (${held.holder.image})`
      : "another runner";
    throw new Error(
      `refusing to run the tasks: the upgrade lease is held by ${holder}. Run them again once it finishes; \`pnpm task upgrade status\` shows an upgrade's run`,
    );
  }
  if (held.lost) throw new Error("the upgrade lease was lost while the tasks ran; run them again");
}

/** The tasks' lease over the database they migrate; the ledger tables are created first. */
export async function holdMigrationLock(
  postgres: UpgradePostgres,
  run: () => Promise<void>,
): Promise<void> {
  const ledger = UpgradeLedgerRepository.create({ postgres });
  await ledger.createTables();
  await holdTasksLease({ ledger, runner: UpgradeRunnerRepository.create({ postgres }), run });
}
