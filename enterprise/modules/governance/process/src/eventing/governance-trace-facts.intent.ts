// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { createLogger } from "@langwatch/observability";

import { GOVERNANCE_TRACE_FACTS_PROCESS_NAME } from "./governance-trace-facts.process.ts";

const logger = createLogger("langwatch:governance:trace-facts");

/** Outbox rows are bookkeeping, one per pass, pruned like every recurring process's. */
const PASS_ROW_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

interface GovernanceTraceFactsRunDeps {
  readonly pull: (window: { fromMs: number; toMs: number }) => Promise<{ written: number }>;
  readonly deleteDispatchedBefore: (params: {
    processName: string;
    before: number;
  }) => Promise<number>;
  readonly now: () => number;
}

/** A failed read or write throws, so the outbox re-drives the same window. */
export function runGovernanceTraceFacts(
  deps: GovernanceTraceFactsRunDeps,
): (payload: { fromMs: number; toMs: number }) => Promise<void> {
  return async (payload): Promise<void> => {
    const startedAt = deps.now();
    const { written } = await deps.pull(payload);
    logger.debug({ ...payload, written }, "governance trace facts pass complete");
    await deps
      .deleteDispatchedBefore({
        processName: GOVERNANCE_TRACE_FACTS_PROCESS_NAME,
        before: startedAt - PASS_ROW_RETENTION_MS,
      })
      .catch(() => 0);
  };
}
