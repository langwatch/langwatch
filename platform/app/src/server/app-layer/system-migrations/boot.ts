import { createLogger } from "@langwatch/observability";
import type { MigrationPassSummary } from "@langwatch/system-migrations";
import type { Cluster, Redis } from "ioredis";

import { runSystemMigrationPass } from "./runtime";

const logger = createLogger("langwatch:system-migrations:boot");

/** Long enough for events emitted by one pass to reach their projections. */
const PASS_INTERVAL_MS = 5_000;

/** A healthy monotonic migration pipeline converges in far fewer passes. */
const MAX_PASSES = 25;

/**
 * How many consecutive passes may find nothing of their own left to do while
 * a peer still holds claims, before that counts as settled.
 *
 * Without it a fleet booting together cannot start at all. Every replica runs
 * this preflight, so on a rolling deploy a dozen of them sweep the same
 * tenants at once, and each one reads the others' leases as `claimed`. None
 * can reach `claimed === 0` while the others are still booting, and none of
 * them finishes booting until it does — each waits for peers who are waiting
 * for it. Observed on a deploy that widened one migration's cohort to every
 * user: `advanced: 0` every pass, `claimed` climbing 100 → 1243, twenty-five
 * passes, then a preflight failure and a crash loop.
 *
 * Three passes rather than one, because a peer mid-tenant is a claim that
 * clears on its own shortly; three in a row is a peer that is working
 * through real volume, not a moment of overlap.
 */
const MAX_CONTENDED_PASSES = 3;

export class SystemMigrationPreflightError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SystemMigrationPreflightError";
  }
}

/**
 * Runs system-migration passes to quiescence before a serving process starts.
 *
 * One pass cannot observe events it just emitted. A later pass is therefore
 * required to prove the resulting projections and finalize each tenant. The
 * first no-progress pass proves quiescence after its queue effects drain.
 * Held and parked tenants keep their migration gates closed, so they can stay
 * on the legacy path without preventing the rest of the application starting.
 * A tenant a PEER is still holding gets the same bargain after
 * `MAX_CONTENDED_PASSES`, because every replica runs this preflight and
 * waiting on each other is how a whole fleet fails to boot.
 *
 * Runner failures and failure to converge are startup failures. They reject
 * this promise so the one-shot task exits non-zero and no runtime lane starts.
 */
export async function runSystemMigrationsToQuiescence({
  redis,
  signal = new AbortController().signal,
  awaitPassEffects,
}: {
  redis?: Redis | Cluster | null;
  signal?: AbortSignal;
  awaitPassEffects?: () => Promise<void>;
} = {}): Promise<MigrationPassSummary> {
  let contendedPasses = 0;

  for (let pass = 1; pass <= MAX_PASSES; pass++) {
    signal.throwIfAborted();
    const summary = await runMigrationPass({ pass, redis, signal });

    signal.throwIfAborted();

    await settlePassEffects({ pass, settle: awaitPassEffects });

    if (converged(summary)) {
      logger.info(
        { summary, passes: pass },
        "system migrations converged; startup may continue",
      );
      return summary;
    }

    contendedPasses = settledExceptForPeers(summary) ? contendedPasses + 1 : 0;
    if (contendedPasses >= MAX_CONTENDED_PASSES) {
      logger.warn(
        { summary, passes: pass },
        "nothing left for this process to advance and a peer still holds claims; starting rather than waiting on a peer that is waiting on us",
      );
      return summary;
    }

    logger.info({ summary, pass }, continuingBecause(summary));

    await waitForNextPass({ pass, signal });
  }

  const message = `System migration preflight did not converge after ${MAX_PASSES} passes`;
  logger.error({ passes: MAX_PASSES }, message);
  throw new SystemMigrationPreflightError(message);
}

async function runMigrationPass({
  pass,
  redis,
  signal,
}: {
  pass: number;
  redis?: Redis | Cluster | null;
  signal: AbortSignal;
}): Promise<MigrationPassSummary> {
  try {
    return await runSystemMigrationPass({ signal, redis });
  } catch (error) {
    logger.error({ error, pass }, "system migration preflight pass failed");
    throw new SystemMigrationPreflightError(
      `System migration preflight failed on pass ${pass}`,
      {
        cause: error,
      },
    );
  }
}

async function settlePassEffects({
  pass,
  settle,
}: {
  pass: number;
  settle?: () => Promise<void>;
}): Promise<void> {
  try {
    await settle?.();
  } catch (error) {
    throw new SystemMigrationPreflightError(
      `System migration queue failed to settle on pass ${pass}`,
      { cause: error },
    );
  }
}

function continuingBecause(summary: MigrationPassSummary): string {
  if (summary.advanced > 0) {
    return "system migration pass advanced the fleet; another pass follows";
  }
  return summary.claimed === summary.tenantsSeen
    ? "every tenant was claimed by another process, which is also what an unreachable Redis looks like; this pass learned nothing, so the preflight keeps trying"
    : "a peer holds some of the fleet; the preflight gives it a few passes before starting without those tenants";
}

function converged(summary: MigrationPassSummary): boolean {
  if (summary.advanced > 0) return false;
  return summary.claimed === 0;
}

/**
 * This pass saw the fleet, moved nothing, and the only outcomes it could not
 * read belong to a peer — the ordinary shape of several replicas booting at
 * once.
 *
 * A pass shut out of the WHOLE fleet is excluded and never counts, however
 * many times it repeats. `lease.acquire` fails safe to "held" on any Redis
 * error, so total contention is also exactly what an unreachable Redis looks
 * like, and a process that learned nothing at all about any tenant has no
 * grounds to call anything settled. Seeing most of the fleet and being shut
 * out of part of it is a different fact: this process has finished its own
 * work, and the tenants it could not claim are being driven by the peer
 * holding them.
 *
 * Starting is safe for those tenants either way. An unfinished tenant's
 * migration gate stays closed and it is served on the legacy path, which is
 * the same thing that happens to one held or parked — and if the peer
 * holding the claims dies before finishing, the worker's re-drive cadence
 * picks them up without another deploy.
 */
function settledExceptForPeers(summary: MigrationPassSummary): boolean {
  if (summary.advanced > 0 || summary.claimed === 0) return false;
  return summary.claimed < summary.tenantsSeen;
}

async function waitForNextPass({
  pass,
  signal,
}: {
  pass: number;
  signal: AbortSignal;
}): Promise<void> {
  if (pass < MAX_PASSES) {
    await sleep({ ms: PASS_INTERVAL_MS, signal });
  }
}

function sleep({
  ms,
  signal,
}: {
  ms: number;
  signal: AbortSignal;
}): Promise<void> {
  signal.throwIfAborted();

  return new Promise<void>((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(signal.reason);
    };
    const onElapsed = (): void => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    };
    const timer = setTimeout(onElapsed, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
