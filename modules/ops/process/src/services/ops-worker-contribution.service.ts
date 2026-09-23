import { createLogger } from "@langwatch/observability";

import type { OpsWorkerHandle } from "../app/ops.app.ts";

const anomalyLogger = createLogger("langwatch:observability:anomalyWorker");

const ANOMALY_TICK_INTERVAL_MS = 60_000;

export interface AnomalyTickResult {
  surfaced: number;
  cleared: number;
}

/** The anomaly capability scheduled by this worker contribution. */
export interface AnomalyTick {
  tick(): Promise<AnomalyTickResult>;
}

export interface AnomalyWorkerContributionOptions {
  detector: AnomalyTick;
}

/**
 * Process-owned scheduling contribution for the tenant rate anomaly service.
 * Construction has no effects; the worker process explicitly calls start.
 */
export class AnomalyWorkerContributionAdapter {
  private constructor(private readonly detector: AnomalyTick) {}

  static create(options: AnomalyWorkerContributionOptions): AnomalyWorkerContributionAdapter {
    return new AnomalyWorkerContributionAdapter(options.detector);
  }

  start(): OpsWorkerHandle {
    let stopped = false;
    let timer: NodeJS.Timeout | undefined;

    const tick = async () => {
      if (stopped) {
        return;
      }

      try {
        const result = await this.detector.tick();
        if (result.surfaced > 0 || result.cleared > 0) {
          anomalyLogger.info(result, "anomaly tick");
        }
      } catch (err) {
        anomalyLogger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          "anomaly detector tick failed (will retry on next interval)",
        );
      }
      if (!stopped) {
        timer = setTimeout(() => void tick(), ANOMALY_TICK_INTERVAL_MS);
      }
    };

    timer = setTimeout(() => void tick(), 5_000);

    anomalyLogger.info("anomaly worker started");

    return {
      async stop() {
        stopped = true;
        if (timer) {
          clearTimeout(timer);
        }

        anomalyLogger.info("anomaly worker stopped");
      },
    };
  }
}
