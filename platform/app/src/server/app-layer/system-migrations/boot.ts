import { createLogger } from "@langwatch/observability";
import type { MigrationPassSummary } from "@langwatch/system-migrations";
import type { Cluster, Redis } from "ioredis";
import { runSystemMigrationPass } from "./runtime";

const logger = createLogger("langwatch:system-migrations:boot");

/** Long enough for events emitted by one pass to reach their projections. */
const PASS_INTERVAL_MS = 5_000;

/** A healthy monotonic migration pipeline converges in far fewer passes. */
const MAX_PASSES = 25;

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
 * A no-progress pass proves quiescence only after its queue effects drain,
 * every tenant outcome is visible, and no finite migration remains held.
 *
 * Runner failures and failure to converge are startup failures. They reject
 * this promise so the one-shot task exits non-zero and no runtime lane starts.
 */
export async function runSystemMigrationsToQuiescence(args?: {
  redis?: Redis | Cluster | null;
  signal?: AbortSignal;
  awaitPassEffects?: () => Promise<void>;
}): Promise<MigrationPassSummary> {
  const signal = args?.signal ?? new AbortController().signal;

  for (let pass = 1; pass <= MAX_PASSES; pass++) {
    signal.throwIfAborted();

    let summary: MigrationPassSummary;
    try {
      summary = await runSystemMigrationPass({
        signal,
        redis: args?.redis,
      });
    } catch (error) {
      logger.error({ error, pass }, "system migration preflight pass failed");
      throw new SystemMigrationPreflightError(
        `System migration preflight failed on pass ${pass}`,
        {
          cause: error,
        },
      );
    }

    signal.throwIfAborted();

    await settlePassEffects({ pass, settle: args?.awaitPassEffects });
    assertPassCanConverge({ summary, pass });

    if (converged(summary)) {
      logger.info(
        { summary, passes: pass },
        "system migrations converged; startup may continue",
      );
      return summary;
    }

    logger.info({ summary, pass }, continuingBecause(summary));

    if (pass < MAX_PASSES) {
      await sleep({ ms: PASS_INTERVAL_MS, signal });
    }
  }

  const message = `System migration preflight did not converge after ${MAX_PASSES} passes`;
  logger.error({ passes: MAX_PASSES }, message);
  throw new SystemMigrationPreflightError(message);
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

function assertPassCanConverge({
  summary,
  pass,
}: {
  summary: MigrationPassSummary;
  pass: number;
}): void {
  if (summary.parked > 0) {
    throw new SystemMigrationPreflightError(
      `System migration preflight parked ${summary.parked} tenant migrations on pass ${pass}`,
    );
  }
  const finiteHeld = summary.finiteHeld ?? summary.held;
  if (finiteHeld > 0 && summary.advanced === 0) {
    throw new SystemMigrationPreflightError(
      `System migration preflight left ${finiteHeld} finite migrations held on pass ${pass}`,
    );
  }
}

function continuingBecause(summary: MigrationPassSummary): string {
  return summary.advanced === 0
    ? "one or more tenants were claimed by another process; the preflight waits until every outcome is known"
    : "system migration pass advanced the fleet; another pass follows";
}

function converged(summary: MigrationPassSummary): boolean {
  if (summary.advanced > 0) return false;
  return summary.claimed === 0;
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
