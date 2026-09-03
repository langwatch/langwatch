// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { createLogger } from "@langwatch/observability";
import {
  AnomalyAlertDispatcherService,
  type AnomalyAlertHttpPort,
  type AnomalySpendReaderPort,
  PostgresSpendSpikeAnomalyAdapter,
} from "@langwatch/enterprise-governance-server";
/**
 * Periodic spend-spike anomaly evaluation tick.
 *
 * A SCHEDULER, NOT A QUEUE CONSUMER, and that is what decides where it is
 * mounted: it claims no routing key on `event-sourcing/jobs`, so it rides an
 * existing feature installer in the worker rather than declaring one of its
 * own — the same arrangement the scheduled-report calendar has. The platform
 * ran it exactly this way too, as `bootSpendSpikeAnomalyWorker` in
 * `src/server/workers/startWorkers.ts`: a `setTimeout` loop pushed onto the
 * process's shutdown handles.
 *
 * Each tick lists active spend_spike AnomalyRules across all orgs, evaluates
 * them against governance_kpis, and persists AnomalyAlert rows for fire
 * decisions.
 *
 * Spec: specs/ai-gateway/governance/anomaly-detection.feature +
 *       specs/ai-gateway/governance/anomaly-rules.feature +
 *       specs/ai-gateway/governance/c3-alert-dispatch.feature
 */

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

export type SpendSpikeAnomalyWorkerDependencies = {
  database: object;
  /**
   * Where the current and baseline windows are read from.
   *
   * REQUIRED, because the process that composes this holds the tenant-keyed
   * ClickHouse client already. The evaluator still carries a
   * "spend storage is not configured" skip for a graph that has none; a worker
   * that took that leg would evaluate every rule, skip every one of them and
   * log a healthy tick — indistinguishable from a fleet where nothing ever
   * spikes.
   */
  spend: AnomalySpendReaderPort;
  http: AnomalyAlertHttpPort;
};

/**
 * Long-running scheduler that runs one spend-spike evaluation tick every
 * 5 minutes. A failing tick is logged and the loop re-arms — governance
 * detection must degrade gracefully.
 *
 * The log line is the whole record of a failed tick. The application forwarded
 * these to PostHog; this process has no error tracker, and inventing a second
 * destination would split one failure mode across two places an operator has
 * to know to look in — the same call `WorkerGovernanceIngestionPullHost.capture`
 * makes.
 */
export function startSpendSpikeAnomalyWorker(
  dependencies: SpendSpikeAnomalyWorkerDependencies,
): SpendSpikeAnomalyWorkerHandle {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  const evaluator = PostgresSpendSpikeAnomalyAdapter.create({
    database: dependencies.database,
    spend: dependencies.spend,
    dispatcher: AnomalyAlertDispatcherService.create({ http: dependencies.http }),
  }).build();

  const tick = async () => {
    if (stopped) return;
    try {
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
      logger.error({ error }, "spend spike anomaly tick failed (will retry on next interval)");
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
