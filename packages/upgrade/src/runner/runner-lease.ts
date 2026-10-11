import { setTimeout as sleep } from "node:timers/promises";

import type { UpgradeLedgerRepository } from "../ledger.repository.ts";
import type { UpgradeLease } from "../ledger.ts";
import type { UpgradeRunnerRepository } from "./runner-ledger.repository.ts";
import type { UpgradeRunnerLog } from "./schema-applier.ts";

export const UPGRADE_LEASE_NAME = "upgrade";

/** How long a lease lives, how often it is renewed, and how long a second runner waits for it. */
export interface UpgradeLeaseTiming {
  ttlMs: number;
  heartbeatMs: number;
  waitMs: number;
  pollMs: number;
}

/** Defaults proposed in the handoff (Risks); every caller may pass its own. */
export const DEFAULT_LEASE_TIMING: UpgradeLeaseTiming = {
  ttlMs: 60_000,
  heartbeatMs: 15_000,
  waitMs: 10 * 60_000,
  pollMs: 5_000,
};

/** How often a runner waiting for the lease says so again. */
export const LEASE_WAIT_REPORT_EVERY_MS = 30_000;

export type LeaseOutcome<Result> =
  | { acquired: true; lost: boolean; result: Result }
  | { acquired: false; holder: UpgradeLease | null };

/** Takes the lease, polling while a live holder keeps it; past `waitMs` answers the holder. */
async function waitForLease({
  ledger,
  runner,
  identity,
  timing,
  log,
  signal,
}: {
  ledger: Pick<UpgradeLedgerRepository, "acquireLease">;
  runner: Pick<UpgradeRunnerRepository, "findLease">;
  identity: { owner: string; image: string; host: string };
  timing: UpgradeLeaseTiming;
  log: UpgradeRunnerLog;
  signal: AbortSignal;
}): Promise<{ acquired: true } | { acquired: false; holder: UpgradeLease | null }> {
  const name = UPGRADE_LEASE_NAME;
  const startedAt = performance.now();
  let reportedAt = 0;
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    if (await ledger.acquireLease({ name, ...identity, ttlMs: timing.ttlMs })) {
      return { acquired: true };
    }
    const holder = await runner.findLease({ name });
    const waitedMs = Math.round(performance.now() - startedAt);
    if (waitedMs >= timing.waitMs) return { acquired: false, holder };
    if (attempt === 0 || waitedMs >= reportedAt + LEASE_WAIT_REPORT_EVERY_MS) {
      reportedAt = attempt === 0 ? 0 : waitedMs;
      const held = holder
        ? `${holder.owner} on ${holder.host} (${holder.image})`
        : "another runner";
      log.info(
        `waiting for the upgrade lease held by ${held}: ${waitedMs} ms of ${timing.waitMs} ms`,
        {
          phase: "lease",
          waitingOn: "the upgrade lease",
          holder: holder?.owner,
          host: holder?.host,
          image: holder?.image,
          waitedMs,
          waitMs: timing.waitMs,
          next: "nothing to do: this run starts when the holder finishes; `pnpm task upgrade status` shows its run",
        },
      );
    }
    await sleep(timing.pollMs, undefined, { signal });
  }
}

/**
 * Runs `work` holding the runner lease (rethink 6.7): waits for a live holder up to `waitMs`, then
 * gives up naming it; renews on a heartbeat; aborts `work` when the lease is lost, or when no
 * renewal has answered for the time to live less one heartbeat (a hung one); releases it.
 */
export async function holdUpgradeLease<Result>({
  ledger,
  runner,
  identity,
  timing,
  log,
  signal,
  work,
}: {
  ledger: Pick<UpgradeLedgerRepository, "acquireLease" | "renewLease" | "releaseLease">;
  runner: Pick<UpgradeRunnerRepository, "findLease">;
  identity: { owner: string; image: string; host: string };
  timing: UpgradeLeaseTiming;
  log: UpgradeRunnerLog;
  signal: AbortSignal;
  work: (args: { signal: AbortSignal }) => Promise<Result>;
}): Promise<LeaseOutcome<Result>> {
  const name = UPGRADE_LEASE_NAME;
  const waited = await waitForLease({ ledger, runner, identity, timing, log, signal });
  if (!waited.acquired) return waited;

  const held = new AbortController();
  const onParentAbort = () => held.abort(signal.reason);
  signal.addEventListener("abort", onParentAbort, { once: true });
  let lost = false;
  const loseLease = (reason: string) => {
    if (lost) return;
    lost = true;
    log.warn("upgrade lease lost; stopping", { reason });
    held.abort(new Error(reason));
  };
  const heartbeat = startHeartbeat({ ledger, name, owner: identity.owner, timing, log, loseLease });

  let stolen = false;
  try {
    const result = await work({ signal: held.signal });
    clearInterval(heartbeat);
    // Asked once more before release: the result stands as recorded, the thief's lease is kept.
    const renewed = lost
      ? null
      : await ledger
          .renewLease({ name, owner: identity.owner, ttlMs: timing.ttlMs })
          .catch(() => null);
    if (!lost && !renewed) {
      stolen = true;
      log.warn("the upgrade lease was not this runner's when its run finished; not releasing it", {
        phase: "lease",
      });
    }
    return { acquired: true, lost, result };
  } finally {
    clearInterval(heartbeat);
    signal.removeEventListener("abort", onParentAbort);
    if (!lost && !stolen) await ledger.releaseLease({ name, owner: identity.owner });
  }
}

/** Renews every heartbeat; no answer for the time to live less one heartbeat loses the lease. */
function startHeartbeat({
  ledger,
  name,
  owner,
  timing,
  log,
  loseLease,
}: {
  ledger: Pick<UpgradeLedgerRepository, "renewLease">;
  name: string;
  owner: string;
  timing: UpgradeLeaseTiming;
  log: UpgradeRunnerLog;
  loseLease: (reason: string) => void;
}): ReturnType<typeof setInterval> {
  let renewedAt = performance.now();
  let renewing = false;
  return setInterval(() => {
    if (performance.now() - renewedAt >= timing.ttlMs - timing.heartbeatMs) {
      loseLease("the upgrade lease was not renewed in time");
      return;
    }
    if (renewing) return;
    renewing = true;
    const sentAt = performance.now();
    void ledger
      .renewLease({ name, owner, ttlMs: timing.ttlMs })
      .then((renewed) => {
        if (renewed) renewedAt = Math.max(renewedAt, sentAt);
        else loseLease("another runner holds the upgrade lease");
      })
      .catch((error: unknown) =>
        log.warn("could not renew the upgrade lease", { error: String(error) }),
      )
      .finally(() => (renewing = false));
  }, timing.heartbeatMs);
}
