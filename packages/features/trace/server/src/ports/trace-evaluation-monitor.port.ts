import type { MonitorSummary } from "@langwatch/monitor-contract";

/**
 * The monitors an ingested trace should be evaluated against.
 *
 * One method, because `evaluationTrigger` calls exactly one: it lists the
 * project's on-message monitors and dispatches an evaluation command per
 * monitor that survives the loop guards. The application narrows the same
 * capability inline with `Pick<MonitorService, "getEnabledOnMessageMonitors">`,
 * which narrows the type and not the wiring — a process still had to build a
 * whole `MonitorService`, and with it the evaluator service and the Prisma
 * client behind it. Naming the port is what makes the read composable on its
 * own.
 *
 * `MonitorService` satisfies it structurally, and so does
 * `PostgresMonitorAdapter.create(...)`, which returns that contract.
 */
export abstract class TraceEvaluationMonitorPort {
  abstract getEnabledOnMessageMonitors(projectId: string): Promise<MonitorSummary[]>;
}
