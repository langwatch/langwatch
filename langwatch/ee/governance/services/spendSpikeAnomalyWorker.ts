// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { createLogger } from "@langwatch/telemetry";
/**
 * Periodic spend-spike anomaly evaluation tick.
 *
 * Replaces the deleted BullMQ anomalyDetectionQueue/anomalyDetectionWorker
 * pair (a repeatable job on a 5-minute cron) with an in-process interval
 * loop, following the same pattern as
 * `src/server/observability/anomalyWorker.ts`.
 * Each tick lists active spend_spike AnomalyRules across all orgs, evaluates
 * them against governance_kpis, and persists AnomalyAlert rows for fire
 * decisions.
 *
 * Spec: specs/ai-gateway/governance/anomaly-detection.feature +
 *       specs/ai-gateway/governance/anomaly-rules.feature
 */
import { prisma } from "~/server/db";
import {
  captureException,
  toError,
  withScope,
} from "~/utils/posthogErrorCapture";
import { SpendSpikeAnomalyEvaluator } from "./spendSpikeAnomalyEvaluator.service";

const logger = createLogger("langwatch:workers:spendSpikeAnomalyWorker");

/**
 * Default tick interval — every 5 minutes, matching the deleted repeatable
 * job's cadence. Tight enough that operators see anomalies within a single
 * coffee break, loose enough that the evaluator query load stays trivial.
 */
const TICK_INTERVAL_MS = 5 * 60 * 1000;

export interface SpendSpikeAnomalyWorkerHandle {
  stop(): void;
}

/**
 * Long-running scheduler that runs one spend-spike evaluation tick every
 * 5 minutes. Failures in an individual tick are logged + captured but do
 * not crash the loop — governance detection must degrade gracefully.
 */
export function startSpendSpikeAnomalyWorker(): SpendSpikeAnomalyWorkerHandle {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;

  const tick = async () => {
    if (stopped) return;
    try {
      const evaluator = SpendSpikeAnomalyEvaluator.create(prisma);
      const result = await evaluator.evaluateAll({ now: new Date() });
      logger.info(
        {
          rulesEvaluated: result.rulesEvaluated,
          alertsFired: result.alertsFired,
          skipped: result.skipped,
        },
        "spend spike anomaly tick complete",
      );
    } catch (error) {
      logger.error(
        { error },
        "spend spike anomaly tick failed (will retry on next interval)",
      );
      await withScope(async (scope) => {
        scope.setTag?.("worker", "spendSpikeAnomaly");
        captureException(toError(error));
      });
    }
    if (!stopped) {
      timer = setTimeout(() => void tick(), TICK_INTERVAL_MS);
    }
  };

  // Initial tick after a short delay so the workers process has a chance
  // to settle before hitting the database.
  timer = setTimeout(() => void tick(), 5_000);

  logger.info("spend spike anomaly worker started");

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      logger.info("spend spike anomaly worker stopped");
    },
  };
}
