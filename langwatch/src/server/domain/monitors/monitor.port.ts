/**
 * Monitor shapes and the lookups event-sourcing performs on them.
 *
 * The two record types are structural — no Prisma row, no app-layer import —
 * so the port stands alone in the domain layer (ADR-063). `MonitorService`
 * satisfies `MonitorPort` structurally.
 */
export interface MonitorSummary {
  id: string;
  checkType: string;
  name: string;
  threadIdleTimeout: number | null;
  evaluator: { name: string } | null;
}

/**
 * Full monitor with optional linked evaluator — used by ExecuteEvaluationCommand
 * to decide sampling, preconditions, settings, and execution mode.
 */
export interface MonitorWithEvaluator {
  id: string;
  checkType: string;
  sample: number;
  preconditions: unknown;
  parameters: unknown;
  mappings: unknown;
  level: string | null;
  evaluator: {
    config: unknown;
    type: string;
    workflowId: string | null;
  } | null;
}

/** The two lookups the evaluation trigger and command need. */
export interface MonitorPort {
  getEnabledOnMessageMonitors(projectId: string): Promise<MonitorSummary[]>;
  getMonitorById(params: {
    projectId: string;
    monitorId: string;
  }): Promise<MonitorWithEvaluator | null>;
}
