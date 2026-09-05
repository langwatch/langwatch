import { createLogger } from "@langwatch/observability";
import type { MigrationPassSummary } from "./types";

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
  })
    .then((summary) => {
      logger.info({ summary }, "system migration pass finished");
    })
    .catch((error) => {
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
 * The same loop, awaited rather than backgrounded: the boot-chain shape, for
 * a caller that must not return before the fleet stopped moving. Same
 * convergence rule, abort handling and never-throws contract.
 */
export async function driveSystemMigrationsToConvergence({
  signal,
  runPass,
}: {
  signal: AbortSignal;
  runPass: SystemMigrationPass;
}): Promise<void> {
  for (let pass = 1; pass <= MAX_PASSES; pass++) {
    if (signal.aborted) return;
    const summary = await passOrNull({ signal, runPass, pass });
    if (summary === null) return;
    // Checked before the stop decision as well as before the next pass: an
    // aborted pass returns whatever it managed, and reading that as
    // convergence would log a false "nothing left to do" at shutdown.
    if (signal.aborted) return;
    if (converged(summary)) {
      logger.info(
        { summary, passes: pass },
        "system migrations converged; nothing advanced on the last pass",
      );
      return;
    }
    logger.info({ summary, pass }, continuingBecause(summary));
    await sleep({ ms: PASS_INTERVAL_MS, signal });
  }
  // Loud on purpose. Passes are supposed to run out of work.
  logger.error(
    { passes: MAX_PASSES },
    "system migrations still reported progress after the maximum passes; stopping. A migration whose status keeps changing without settling is the likely cause",
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
function continuingBecause(summary: MigrationPassSummary): string {
  return summary.advanced === 0
    ? "every organization was claimed by another process; the loop keeps going rather than reading that as convergence"
    : "system migration pass advanced the fleet; another pass follows";
}

/**
 * Whether a pass proves there is nothing left to do. Nothing advanced is not enough on its own.
 */
function converged(summary: MigrationPassSummary): boolean {
  if (summary.advanced > 0) return false;
  if (summary.tenantsSeen === 0) return true;
  return summary.claimed < summary.tenantsSeen;
}

/** Waits, or returns early the moment the signal aborts. */
function sleep({ ms, signal }: { ms: number; signal: AbortSignal }): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const done = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    // Never let the gap between two passes alone hold the process open.
    timer.unref?.();
    signal.addEventListener("abort", done, { once: true });
  });
}
