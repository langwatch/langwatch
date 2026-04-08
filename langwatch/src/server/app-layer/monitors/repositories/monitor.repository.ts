export interface MonitorSummary {
  id: string;
  checkType: string;
  name: string;
  threadIdleTimeout: number | null;
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

export interface MonitorRepository {
  getEnabledOnMessageMonitors(projectId: string): Promise<MonitorSummary[]>;
  getMonitorById(params: { projectId: string; monitorId: string }): Promise<MonitorWithEvaluator | null>;
}

export class NullMonitorRepository implements MonitorRepository {
  async getEnabledOnMessageMonitors(
    _projectId: string,
  ): Promise<MonitorSummary[]> {
    return [];
  }

  async getMonitorById(
    _params: { projectId: string; monitorId: string },
  ): Promise<MonitorWithEvaluator | null> {
    return null;
  }
}
