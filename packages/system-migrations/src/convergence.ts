import { createLogger } from "@langwatch/observability";

import type { MigrationPassSummary } from "./types.ts";

/**
 * One composed pass over the fleet. The composition root binds the runner,
 * its repositories, the registered migrations and whatever Redis the lease
 * uses; this loop only decides whether another pass is worth running.
 */
export type SystemMigrationPass = (input: { signal: AbortSignal }) => Promise<MigrationPassSummary>;

const logger = createLogger("langwatch:system-migrations:boot");

/**
 * How long the loop waits between passes. Two constraints, and the larger one is not the
 * obvious one. A pass cannot
 * observe its own events - it states facts and checks once (ADR-110), so a
 */
const PASS_INTERVAL_MS = 5_000;

/**
 * The backstop, not the mechanism. Convergence is bounded by the state machine: a tenant moves
 * pending -> migrated -> finalized, so it needs a couple of passes per registered migration,
 * and the loop stops on its own the moment a whole pass moves nothing.
 */
const MAX_PASSES = 25;

/**
 * Drive migration passes in the background from worker boot until the fleet stops moving, then
 * stop. One pass is never enough on its own: a pass cannot observe its own events, so a tenant
 * it adopts reads as held and only a LATER pass finalizes it.
 */
export function startSystemMigrations(args: { runPass: SystemMigrationPass }): {
  stop: () => Promise<void>;
} {
  const controller = new AbortController();
  const loop = driveSystemMigrationsToConvergence({
    signal: controller.signal,
    runPass: args.runPass,
  }).catch((error) => {
    logger.error({ error }, "system migration pass failed; next boot retries");
  });
  return {
    stop: async () => {
      controller.abort();
      await loop;
    },
  };
}

/**
 * The same loop, awaited rather than backgrounded. Bounded and never a gate:
 * a loop still moving at the cap stops and says the fleet did not settle, and
 * a held or parked tenant is reported, never waited on (plan §6.8, Alex Q7).
 */
export async function driveSystemMigrationsToConvergence({
  signal,
  runPass,
}: {
  signal: AbortSignal;
  runPass: SystemMigrationPass;
}): Promise<void> {
  let leaseGranted = false;
  for (let pass = 1; pass <= MAX_PASSES; pass++) {
    if (signal.aborted) return;
    const summary = await passOrNull({ signal, runPass, pass });
    if (summary === null) return;
    leaseGranted ||= claimWasGranted(summary);
    // Checked before the stop decision as well as before the next pass: an
    // aborted pass returns whatever it managed, and reading that as
    // convergence would log a false "nothing left to do" at shutdown.
    if (signal.aborted) return;
    if (converged({ summary, leaseGranted })) {
      logSettled({ summary, passes: pass });
      return;
    }
    logger.info({ summary, pass }, continuingBecause({ summary, leaseGranted }));
    await sleep({ ms: PASS_INTERVAL_MS, signal });
  }
  // Loud on purpose. Passes are supposed to run out of work.
  logger.error(
    { passes: MAX_PASSES },
    `system migrations did not settle after ${MAX_PASSES} passes; stopping without claiming success. Nothing waits on them and later passes carry on. A migration whose status keeps changing is the likely cause`,
  );
}

/** Settled is not success: held and parked tenants are named in the log, never hidden. */
function logSettled({ summary, passes }: { summary: MigrationPassSummary; passes: number }): void {
  if (summary.held + summary.parked === 0) {
    logger.info(
      { summary, passes },
      "system migrations settled; nothing advanced on the last pass",
    );
    return;
  }
  logger.warn(
    { summary, passes, held: summary.held, parked: summary.parked },
    "system migrations settled with tenants held or parked; they stay on their legacy path and nothing waits on them",
  );
}

/**
 * One pass, or null when it died. A pass that THROWS is the pass itself failing - the state
 * table or the tenant source is down, since per-tenant failures park inside it.
 */
async function passOrNull({
  signal,
  runPass,
  pass,
}: {
  signal: AbortSignal;
  runPass: SystemMigrationPass;
  pass: number;
}): Promise<MigrationPassSummary | null> {
  try {
    return await runPass({ signal });
  } catch (error) {
    logger.error(
      { error, pass },
      "system migration pass failed; the loop stops and the next boot retries",
    );
    return null;
  }
}

/** Why the loop is about to run another pass, in the log's words. */
function continuingBecause({
  summary,
  leaseGranted,
}: {
  summary: MigrationPassSummary;
  leaseGranted: boolean;
}): string {
  if (summary.advanced > 0) return "system migration pass advanced the fleet; another pass follows";
  return leaseGranted
    ? "a peer holds the tenants with work left; the loop keeps going while it drives them"
    : "every tenant was claimed by another process and no claim has been granted yet, which is also what an unreachable lease store looks like; this pass learned nothing, so the loop keeps trying";
}

/**
 * Whether a pass proves there is nothing left to do. A total shut-out settles
 * only once the lease store granted this process a claim: a pass enumerates
 * only the tenants with work left, which peers can genuinely all hold (#8247).
 */
function converged({
  summary,
  leaseGranted,
}: {
  summary: MigrationPassSummary;
  leaseGranted: boolean;
}): boolean {
  if (summary.advanced > 0) return false;
  if (summary.tenantsSeen === 0) return true;
  if (summary.claimed < summary.tenantsSeen) return true;
  return leaseGranted;
}

/** Did the lease store hand THIS process a claim on this pass? `acquire`
 *  fails safe to "held" on every error, so one tenant the pass saw and did not
 *  count as claimed is proof the store is reachable and answering. */
function claimWasGranted(summary: MigrationPassSummary): boolean {
  return summary.tenantsSeen > summary.claimed;
}

/** Waits, or returns early the moment the signal aborts. */
function sleep({ ms, signal }: { ms: number; signal: AbortSignal }): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const done = (): void => {
      globalThis.clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    // Never let the gap between two passes alone hold the process open.
    timer.unref?.();
    signal.addEventListener("abort", done, { once: true });
  });
}
