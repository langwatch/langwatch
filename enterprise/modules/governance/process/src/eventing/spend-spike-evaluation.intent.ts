// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { createLogger } from "@langwatch/observability";

import type { SpendSpikeEvaluationSummary } from "../services/spend-spike-anomaly-evaluator.service.ts";
import { SPEND_SPIKE_EVALUATION_PROCESS_NAME } from "./spend-spike-evaluation.process.ts";

const logger = createLogger("langwatch:governance:spend-spike-evaluation");

/** Outbox rows are bookkeeping, one per pass, pruned like every recurring process's. */
const PASS_ROW_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

interface SpendSpikeEvaluationRunDeps {
  readonly evaluate: () => Promise<SpendSpikeEvaluationSummary>;
  readonly deleteDispatchedBefore: (params: {
    processName: string;
    before: number;
  }) => Promise<number>;
  readonly now: () => number;
}

/** A failed pass throws, and the next wake evaluates again, as main's next tick did. */
export function runSpendSpikeEvaluation(deps: SpendSpikeEvaluationRunDeps): () => Promise<void> {
  return async (): Promise<void> => {
    const startedAt = deps.now();
    const summary = await deps.evaluate();
    logger.info(summary, "spend spike anomaly tick complete");
    await deps
      .deleteDispatchedBefore({
        processName: SPEND_SPIKE_EVALUATION_PROCESS_NAME,
        before: startedAt - PASS_ROW_RETENTION_MS,
      })
      .catch(() => 0);
  };
}
