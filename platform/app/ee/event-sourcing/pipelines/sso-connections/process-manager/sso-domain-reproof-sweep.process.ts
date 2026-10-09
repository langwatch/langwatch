// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { SsoDomainReproofOutcome } from "@ee/sso/sso-domain-reproof.service";
import { createLogger } from "@langwatch/observability";
import { z } from "zod";

import type {
  IntentSpec,
  WakeHandler,
} from "~/server/event-sourcing/pipeline/processManagerDefinition";

const logger = createLogger("langwatch:identity:sso-domain-reproof:sweep");

export const SSO_DOMAIN_REPROOF_SWEEP_PROCESS_NAME = "ssoDomainReproofSweep";

/**
 * Every eight hours — three reads of a domain a day.
 *
 * Chosen against the grace window rather than against DNS: forty-eight hours
 * of grace divided by an eight-hour cadence is six chances to notice a
 * republish before anything stops, so an administrator who fixes the record
 * the same day never reaches a lapse. Finer than that would buy nothing a
 * customer could perceive and would multiply the lookups a large deployment
 * makes against other people's nameservers.
 */
export const SSO_DOMAIN_REPROOF_SWEEP_INTERVAL_MS = 8 * 60 * 60 * 1000;

/**
 * Outbox rows this process writes are bookkeeping, one per tick, pruned on the
 * same schedule every other recurring process uses.
 */
const SWEEP_ROW_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export const ssoDomainReproofSweepSchema = z.object({
  scheduledFor: z.number().int(),
});

export interface SsoDomainReproofSweepState {
  lastSweepAt: number | null;
}

export interface SsoDomainReproofSweepDeps {
  sweep: () => Promise<SsoDomainReproofOutcome>;
  deleteDispatchedBefore: (params: {
    processName: string;
    before: number;
  }) => Promise<number>;
  now?: () => number;
}

type SsoDomainReproofSweepIntents = {
  sweep: IntentSpec<typeof ssoDomainReproofSweepSchema>;
};

/**
 * Wake handlers must be pure and synchronous, with no I/O and no clock read,
 * because the commit that persists this evolution is what fences racing
 * workers. The DNS re-reads run as an intent instead, behind the outbox
 * lease.
 */
export const ssoDomainReproofSweepWake: WakeHandler<
  SsoDomainReproofSweepState,
  SsoDomainReproofSweepIntents
> = (_state, ctx) => ({
  state: { lastSweepAt: ctx.at },
  intents: [ctx.intents.sweep(`sweep:${ctx.at}`, { scheduledFor: ctx.at })],
});

/**
 * What one sweep is worth saying out loud.
 *
 * Only what CHANGED. A healthy deployment sweeps hundreds of domains three
 * times a day and finds every one of them exactly where it was; a line per
 * tick would bury the one that matters under a thousand that never do.
 */
function report(outcome: SsoDomainReproofOutcome): void {
  if (outcome.wavered > 0 || outcome.lapsed > 0 || outcome.recovered > 0) {
    logger.info(
      {
        checked: outcome.checked,
        wavered: outcome.wavered,
        lapsed: outcome.lapsed,
        recovered: outcome.recovered,
      },
      "domain verification records changed",
    );
  }
  // A resolver having a bad minute is neither ours to page on nor the
  // customer's to be blamed for, and it advanced nobody's clock.
  if (outcome.unreachable > 0) {
    logger.warn(
      { unreachable: outcome.unreachable, checked: outcome.checked },
      "some domain verification records could not be looked up (no clock was advanced)",
    );
  }
  for (const failure of outcome.failed) {
    logger.warn(
      { domain: failure.domain, error: failure.error },
      "a domain's verification record could not be re-read (will retry on the next interval)",
    );
  }
  // A FULL BATCH IS NOT A FINISHED SWEEP. The sweep is round-robin by
  // `lastReproofAt`, so nothing is skipped forever — but an installation
  // whose connection count has outgrown the batch takes several cycles to
  // come round, and that is worth knowing before somebody wonders why a
  // lapse took a day. Silent truncation reads exactly like full coverage.
  if (outcome.truncated) {
    logger.warn(
      { checked: outcome.checked },
      "the re-proof batch filled; the remaining connections are swept on the following intervals",
    );
  }
}

export function runSsoDomainReproofSweep({
  sweep,
  deleteDispatchedBefore,
  now,
}: SsoDomainReproofSweepDeps) {
  return async (): Promise<void> => {
    const startedAt = (now ?? Date.now)();
    report(await sweep());

    try {
      await deleteDispatchedBefore({
        processName: SSO_DOMAIN_REPROOF_SWEEP_PROCESS_NAME,
        before: startedAt - SWEEP_ROW_RETENTION_MS,
      });
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "SSO domain reproof outbox retention failed",
      );
    }
  };
}
