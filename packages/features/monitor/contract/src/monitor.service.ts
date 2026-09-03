import type {
  EnabledGuardrailMonitor,
  Monitor,
  MonitorCreateInput,
  MonitorEnabledGuardrailInput,
  MonitorExperimentUpsertInput,
  MonitorIdInput,
  MonitorNameAvailabilityInput,
  MonitorReplicationInput,
  MonitorSummary,
  MonitorToggleInput,
  MonitorUpdateInput,
  MonitorWithEvaluator,
} from "./monitor";

export abstract class MonitorService {
  abstract getAllForProject(input: { projectId: string }): Promise<MonitorWithEvaluator[]>;
  abstract getEnabledOnMessageMonitors(projectId: string): Promise<MonitorSummary[]>;
  abstract listEnabledGuardrailMonitors(
    input: MonitorEnabledGuardrailInput,
  ): Promise<EnabledGuardrailMonitor[]>;
  abstract getById(input: MonitorIdInput): Promise<MonitorWithEvaluator>;
  abstract tryGetMonitorById(input: MonitorIdInput): Promise<MonitorWithEvaluator | null>;
  abstract getAllByIds(input: { monitorIds: string[]; projectId: string }): Promise<Monitor[]>;
  abstract toggle(input: MonitorToggleInput): Promise<{ success: true }>;
  abstract create(input: MonitorCreateInput): Promise<Monitor>;
  abstract update(input: MonitorUpdateInput): Promise<Monitor>;
  abstract delete(input: MonitorIdInput): Promise<{ success: true }>;
  abstract deleteForExperiment(input: { projectId: string; experimentId: string }): Promise<void>;
  /**
   * Creates or replaces the monitor an experiment is published as.
   *
   * The counterpart to `deleteForExperiment`: both are keyed by the experiment
   * rather than by the monitor, because the experiment is what owns the row.
   */
  abstract upsertForExperiment(input: MonitorExperimentUpsertInput): Promise<Monitor>;
  abstract isNameAvailable(input: MonitorNameAvailabilityInput): Promise<{ available: boolean }>;
  abstract replicate(input: MonitorReplicationInput): Promise<Monitor>;
}
