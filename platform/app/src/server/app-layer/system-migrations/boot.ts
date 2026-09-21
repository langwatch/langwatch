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
 * first no-progress pass proves quiescence after its queue effects drain.
 * Held and parked tenants keep their migration gates closed, so they can stay
 * on the legacy path without preventing the rest of the application starting.
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
  return summary.advanced === 0
    ? "one or more tenants were claimed by another process; the preflight waits until every outcome is known"
    : "system migration pass advanced the fleet; another pass follows";
}

function converged(summary: MigrationPassSummary): boolean {
  if (summary.advanced > 0) return false;
  return summary.claimed === 0;
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
