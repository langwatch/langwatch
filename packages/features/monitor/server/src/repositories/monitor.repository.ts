import type {
  EnabledGuardrailMonitor,
  Monitor,
  MonitorCreateInput,
  MonitorEnabledGuardrailInput,
  MonitorExecutionMode,
  MonitorExperimentUpsertInput,
  MonitorMappingState,
  MonitorSummary,
  MonitorToggleInput,
  MonitorUpdateInput,
  MonitorWithEvaluator,
} from "@langwatch/monitor-contract";

/** The rows a monitor is stored in, as the feature reads and writes them. */
export interface MonitorRepository {
  findAll(input: { projectId: string }): Promise<MonitorWithEvaluator[]>;
  findEnabledOnMessage(projectId: string): Promise<MonitorSummary[]>;
  findEnabledGuardrails(input: MonitorEnabledGuardrailInput): Promise<EnabledGuardrailMonitor[]>;
  findById(input: { id: string; projectId: string }): Promise<MonitorWithEvaluator | undefined>;
  findAllByIds(input: { monitorIds: string[]; projectId: string }): Promise<Monitor[]>;
  /** The monitor already holding this name in the project, if one does. */
  findIdByName(input: { projectId: string; name: string }): Promise<string | undefined>;
  setEnabled(input: MonitorToggleInput): Promise<void>;
  create(
    input: MonitorCreateInput & { id: string; slug: string; mappings: MonitorMappingState },
  ): Promise<Monitor>;
  createReplica(input: Monitor): Promise<Monitor>;
  update(
    input: MonitorUpdateInput & { slug: string; mappings: MonitorMappingState },
  ): Promise<Monitor>;
  delete(input: { id: string; projectId: string }): Promise<void>;
  deleteForExperiment(input: { projectId: string; experimentId: string }): Promise<void>;
  upsertForExperiment(
    input: MonitorExperimentUpsertInput & {
      id: string;
      mappings: MonitorMappingState;
      executionMode: MonitorExecutionMode;
    },
  ): Promise<Monitor>;
}
