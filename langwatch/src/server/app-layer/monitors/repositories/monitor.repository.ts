// Both shapes live in the domain layer so event-sourcing can name them without
// importing app-layer (ADR-063). One definition, re-exported here.
export type {
  MonitorSummary,
  MonitorWithEvaluator,
} from "~/server/domain/monitors/monitor.port";
import type {
  MonitorSummary,
  MonitorWithEvaluator,
} from "~/server/domain/monitors/monitor.port";
import type { Monitor } from "@prisma/client";

export interface MonitorRepository {
  getEnabledOnMessageMonitors(projectId: string): Promise<MonitorSummary[]>;
  getMonitorById(params: { projectId: string; monitorId: string }): Promise<MonitorWithEvaluator | null>;
  /**
   * Full monitor rows for the given ids, scoped to the project — the
   * automations list resolves trigger filter check-keys to monitors with
   * this. Ids not in the project simply don't come back.
   */
  findAllByIds(params: {
    monitorIds: string[];
    projectId: string;
  }): Promise<Monitor[]>;
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

  async findAllByIds(_params: {
    monitorIds: string[];
    projectId: string;
  }): Promise<Monitor[]> {
    return [];
  }
}
