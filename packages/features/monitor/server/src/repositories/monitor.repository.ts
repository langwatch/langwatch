import type {
  Monitor,
  MonitorCreateInput,
  MonitorMappingState,
  MonitorNameAvailabilityInput,
  MonitorSummary,
  MonitorToggleInput,
  MonitorUpdateInput,
  MonitorWithEvaluator,
} from "@langwatch/monitor-contract";

export abstract class MonitorRepository {
  abstract findAll(input: { projectId: string }): Promise<MonitorWithEvaluator[]>;
  abstract findEnabledOnMessage(projectId: string): Promise<MonitorSummary[]>;
  abstract tryFindById(input: { id: string; projectId: string }): Promise<MonitorWithEvaluator | null>;
  abstract findAllByIds(input: { monitorIds: string[]; projectId: string }): Promise<Monitor[]>;
  abstract setEnabled(input: MonitorToggleInput): Promise<void>;
  abstract create(input: MonitorCreateInput & { id: string; slug: string; mappings: MonitorMappingState }): Promise<Monitor>;
  abstract update(input: MonitorUpdateInput & { slug: string; mappings: MonitorMappingState }): Promise<Monitor>;
  abstract delete(input: { id: string; projectId: string }): Promise<void>;
  abstract deleteForExperiment(input: {
    projectId: string;
    experimentId: string;
  }): Promise<void>;
  abstract isNameAvailable(input: MonitorNameAvailabilityInput): Promise<boolean>;
}
