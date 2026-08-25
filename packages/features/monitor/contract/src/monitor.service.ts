import type {
  Monitor,
  MonitorCreateInput,
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
  abstract getById(input: MonitorIdInput): Promise<MonitorWithEvaluator>;
  abstract tryGetMonitorById(input: MonitorIdInput): Promise<MonitorWithEvaluator | null>;
  abstract getAllByIds(input: { monitorIds: string[]; projectId: string }): Promise<Monitor[]>;
  abstract toggle(input: MonitorToggleInput): Promise<{ success: true }>;
  abstract create(input: MonitorCreateInput): Promise<Monitor>;
  abstract update(input: MonitorUpdateInput): Promise<Monitor>;
  abstract delete(input: MonitorIdInput): Promise<{ success: true }>;
  abstract deleteForExperiment(input: {
    projectId: string;
    experimentId: string;
  }): Promise<void>;
  abstract isNameAvailable(input: MonitorNameAvailabilityInput): Promise<{ available: boolean }>;
  abstract replicate(input: MonitorReplicationInput): Promise<Monitor>;
}
