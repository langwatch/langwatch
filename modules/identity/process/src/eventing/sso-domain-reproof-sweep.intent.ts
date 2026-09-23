import type { SsoDomainReproofOutcome } from "@langwatch/identity-contract";
import { createLogger } from "@langwatch/observability";

import { SSO_DOMAIN_REPROOF_SWEEP_PROCESS_NAME } from "./sso-domain-reproof-sweep.process.ts";

const logger = createLogger("langwatch:identity:sso-domain-reproof:sweep");

/** Outbox rows are bookkeeping, one per tick, pruned like every recurring process's. */
const SWEEP_ROW_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export interface SsoDomainReproofSweepDeps {
  sweep: () => Promise<SsoDomainReproofOutcome>;
  deleteDispatchedBefore: (params: { processName: string; before: number }) => Promise<number>;
  now?: () => number;
}

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
  // A resolver having a bad minute advanced nobody's clock.
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
  // A full batch is not a finished sweep: silent truncation reads like full coverage.
  if (outcome.truncated) {
    logger.warn(
      { checked: outcome.checked },
      "the re-proof batch filled; the remaining connections are swept on the following intervals",
    );
  }
}

export function runSsoDomainReproofSweep(deps: SsoDomainReproofSweepDeps): () => Promise<void> {
  return async (): Promise<void> => {
    const startedAt = (deps.now ?? Date.now)();
    report(await deps.sweep());

    try {
      await deps.deleteDispatchedBefore({
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
