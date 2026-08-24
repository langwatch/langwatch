import { createLogger } from "@langwatch/observability";
import type { MigrationPassSummary } from "@langwatch/system-migrations";
import type { Cluster, Redis } from "ioredis";
import { runSystemMigrationPass } from "./runtime";

const logger = createLogger("langwatch:system-migrations:boot");

/**
 * How long the loop waits between passes.
 *
 * Two constraints, and the larger one is not the obvious one. A pass cannot
 * observe its own events - it states facts and checks once (ADR-110), so a
 * tenant it just stated reads as held until the fold catches up - which
 * makes this gap the thing that decides whether the NEXT pass finalizes that
 * tenant or merely re-holds it. It must comfortably exceed a fold queue
 * round trip. It also keeps a loop over an installation with nothing to do
 * from becoming a hot spin against Postgres, ClickHouse and Redis, since
 * such a pass returns in milliseconds. Five seconds clears a queue round
 * trip with room to spare and is noise next to a pass's own work.
 */
const PASS_INTERVAL_MS = 5_000;

/**
 * The backstop, not the mechanism. Convergence is bounded by the state
 * machine: a tenant moves pending -> migrated -> finalized, so it needs a
 * couple of passes per registered migration, and the loop stops on its own
 * the moment a whole pass moves nothing. A healthy installation is done in
 * single digits whatever its size, because one pass advances every tenant
 * that can advance, not one of them. Reaching this cap means a pass reported
 * progress over and over - a status oscillating between two non-terminal
 * states - which is a bug in a migration, not a big fleet. Twenty-five
 * leaves several times the headroom any real pipeline needs while keeping a
 * misbehaving migration from sweeping the fleet indefinitely.
 */
const MAX_PASSES = 25;

/**
 * Drive migration passes in the background from worker boot until the fleet
 * stops moving, then stop.
 *
 * One pass is never enough on its own: a pass cannot observe its own events,
 * so a tenant it adopts reads as held and only a LATER pass finalizes it.
 * Kicking exactly one and waiting for the next restart made convergence a
 * function of the deploy cadence, and on a self-hosted installation - where
 * the doctrine is that an operator never learns a migration happened - of an
 * operator clicking "run a pass" on the ops page until the counts settled.
 * So this loops.
 *
 * It stops on NO PROGRESS, never on "everything is terminal": a held tenant
 * is re-proved every pass and may legitimately never reach a terminal state,
 * so waiting for terminal would spin forever. `advanced` is the pass's count
 * of state TRANSITIONS, and a pass that made none is a pass whose repeat
 * would make none either - so the loop is done, and a tenant still held is
 * left held exactly as a single pass would have left it, for the next boot
 * or an operator to revisit.
 *
 * Everything the single-pass version guaranteed still holds: it never blocks
 * boot, never throws out of here, and tears down through `stop()` and the
 * AbortController - checked between passes and honoured by the sleep, so
 * shutdown never waits out an interval.
 *
 * Composed by the app layer (presets.ts) alongside the other worker-only
 * background loops, and torn down through the App's graceful closeables.
 */
export function startSystemMigrations(args?: {
  redis?: Redis | Cluster | null;
}): { stop: () => Promise<void> } {
  const controller = new AbortController();
  const loop = driveUntilConverged({
    signal: controller.signal,
    redis: args?.redis,
  }).catch((error) => {
    // Belt and braces: `driveUntilConverged` already contains a failed pass.
    // Nothing may escape into the boot path.
    logger.error({ error }, "the system migration loop failed unexpectedly");
  });
  return {
    stop: async () => {
      controller.abort();
      await loop;
    },
  };
}

async function driveUntilConverged({
  signal,
  redis,
}: {
  signal: AbortSignal;
  redis?: Redis | Cluster | null;
}): Promise<void> {
  for (let pass = 1; pass <= MAX_PASSES; pass++) {
    if (signal.aborted) return;
    let summary: MigrationPassSummary;
    try {
      summary = await runSystemMigrationPass({ signal, redis });
    } catch (error) {
      // A pass that throws is the pass itself dying - the state table or the
      // tenant source is down, since per-tenant failures park inside the
      // pass. Retrying it on a five-second cadence would hammer whatever is
      // already broken, so the loop ends here and the next boot starts over,
      // exactly as a single failed pass used to.
      logger.error(
        { error, pass },
        "system migration pass failed; the loop stops and the next boot retries",
      );
      return;
    }
    // Checked before the stop decision as well as before the next pass: an
    // aborted pass returns whatever it managed, and reading that as
    // convergence would log a false "nothing left to do" at shutdown.
    if (signal.aborted) return;
    if (summary.advanced === 0) {
      logger.info(
        { summary, passes: pass },
        "system migrations converged; nothing advanced on the last pass",
      );
      return;
    }
    logger.info(
      { summary, pass },
      "system migration pass advanced the fleet; another pass follows",
    );
    await sleep({ ms: PASS_INTERVAL_MS, signal });
  }
  // Loud on purpose. Passes are supposed to run out of work.
  logger.error(
    { passes: MAX_PASSES },
    "system migrations still reported progress after the maximum passes; stopping. A migration whose status keeps changing without settling is the likely cause",
  );
}

/** Waits, or returns early the moment the signal aborts. */
function sleep({
  ms,
  signal,
}: {
  ms: number;
  signal: AbortSignal;
}): Promise<void> {
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
