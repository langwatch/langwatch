import {
  counter,
  histogram,
  type CounterHandle,
  type HistogramHandle,
} from "@langwatch/observability/metrics";

import { ScenarioProcessorServiceMetricsPort } from "../ports/scenario-processor-metrics.port";

const JOB_TYPE = "scenario";

/**
 * The processor's own counts, on the two instruments every other job in the
 * fleet already reports to.
 *
 * `job_type` rather than a scenario-specific metric name, because the question
 * an operator asks is "which job class is failing", and an instrument only
 * simulations write to cannot be compared against the others on one panel.
 */
export class OtelScenarioProcessorMetricsAdapter extends ScenarioProcessorServiceMetricsPort {
  static create(): OtelScenarioProcessorMetricsAdapter {
    return new OtelScenarioProcessorMetricsAdapter();
  }

  private readonly jobs: CounterHandle = counter({
    name: "job_processing_counter",
    description: "Jobs processed, by job type and outcome",
  });

  private readonly duration: HistogramHandle = histogram({
    name: "job_processing_duration_milliseconds",
    description: "Wall-clock duration of a processed job",
  });

  private constructor() {
    super();
  }

  started(): void {
    this.jobs.inc({ job_type: JOB_TYPE, status: "started" });
  }

  completed(durationMs: number): void {
    this.jobs.inc({ job_type: JOB_TYPE, status: "completed" });
    this.duration.observe(durationMs, { job_type: JOB_TYPE });
  }

  failed(): void {
    this.jobs.inc({ job_type: JOB_TYPE, status: "failed" });
  }
}
