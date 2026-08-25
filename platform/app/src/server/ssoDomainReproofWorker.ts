/**
 * The sweep that re-reads the records proving domains (ADR-123 — see
 * specs/identity/sso-domain-verification.feature).
 *
 * An in-process interval loop, the same shape as `breakGlassExpiryWorker`
 * next to it: there is no per-organization calendar to keep and no row to
 * schedule against, only "read every proved domain's record again and say
 * what changed".
 *
 * A missed tick costs a late waver, never a wrong one. The clock a domain
 * lapses on is written on the wavering fact and compared at the moment a
 * check runs, so a worker that was down over a weekend produces a lapse on
 * the first tick after it comes back rather than a lapse that silently
 * happened while nobody was looking — and a resolver of ours that could not
 * answer produces nothing at all, which is the property the whole design
 * rests on.
 */

import type { SsoDomainReproofOutcome } from "@langwatch/identity-server";
import { createLogger } from "@langwatch/observability";
import { ssoDomainReproof } from "~/server/app-layer/identity/runtime";
import {
  captureException,
  toError,
  withScope,
} from "~/utils/posthogErrorCapture";

const logger = createLogger("langwatch:workers:ssoDomainReproofWorker");

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
export const SSO_DOMAIN_REPROOF_INTERVAL_MS = 8 * 60 * 60 * 1000;

export interface SsoDomainReproofWorkerHandle {
  stop(): void;
}

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
}

export function startSsoDomainReproofWorker():
  | SsoDomainReproofWorkerHandle
  | undefined {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;

  const tick = async () => {
    if (stopped) return;
    try {
      report(await ssoDomainReproof().sweep());
    } catch (error) {
      logger.warn(
        { error },
        "domain verification sweep failed (will retry on the next interval)",
      );
      await withScope(async (scope) => {
        scope.setTag?.("worker", "ssoDomainReproof");
        captureException(toError(error));
      });
    }
    if (!stopped) {
      timer = setTimeout(() => void tick(), SSO_DOMAIN_REPROOF_INTERVAL_MS);
    }
  };

  // Five minutes in rather than at boot. The first tick makes outbound DNS
  // lookups and writes to the ledger, and a pod restarting in a crash loop
  // should not do either before it has stayed up long enough to be trusted
  // with them.
  timer = setTimeout(() => void tick(), 5 * 60_000);
  logger.info("sso domain re-proof worker started");

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      logger.info("sso domain re-proof worker stopped");
    },
  };
}
