import { defineProcessModule } from "@langwatch/process";

import { EvaluationModule } from "./app/evaluation.app.ts";
import { evaluationLifecycleEventing } from "./eventing/evaluation-lifecycle.pipeline.ts";
import { evaluationProcessingEventing } from "./eventing/evaluation-processing.pipeline.ts";
import type { EvaluationClickHouseResolver } from "./repositories/clickhouse/clickhouse.evaluation-session.store.ts";
import { ClickHouseMonitorPerformanceRepository } from "./repositories/clickhouse/monitor-performance.repository.ts";
import { evaluationRepositories } from "./repositories/evaluation-repositories.registry.ts";
import { MonitorPerformanceService } from "./services/monitor-performance.service.ts";
import { evaluationTrpcTransport } from "./transport/evaluation.trpc.ts";
import { evaluationsLegacyRest } from "./transport/evaluations-legacy.rest.ts";

export const evaluationProcessModule = defineProcessModule("evaluation")
  .withRepositories(evaluationRepositories)
  .withApi(EvaluationModule)
  .withTransports(evaluationTrpcTransport, evaluationsLegacyRest)
  .withEventing(evaluationProcessingEventing)
  .withEventing(evaluationLifecycleEventing);

// Evaluation's composition seam: a process reads the monitor trend through this factory and
// never names one of its repositories or services.
/** The monitors page's seven-day trend, for a process that reads it and executes nothing. */
type MonitorPerformanceReads = MonitorPerformanceService;

/** Reads the monitor performance trend, with no execution capability composed. */
export function createMonitorPerformanceReads(input: {
  resolveClickHouse: EvaluationClickHouseResolver;
}): MonitorPerformanceReads {
  return MonitorPerformanceService.create({
    repository: ClickHouseMonitorPerformanceRepository.create({
      resolveClient: input.resolveClickHouse,
    }),
  });
}
