import { moduleApi } from "@langwatch/runtime-composition";
import type { OnlineEvaluationPerformance } from "@langwatch/evaluation-contract";
import type {
  EnabledGuardrailMonitor,
  Monitor,
  MonitorCopyInput,
  MonitorCreateInput,
  MonitorEnabledGuardrailInput,
  MonitorExperimentUpsertInput,
  MonitorIdInput,
  MonitorNameAvailabilityInput,
  MonitorPatchInput,
  MonitorPerformanceInput,
  MonitorReplicationInput,
  MonitorRunnableCheckInput,
  MonitorSummary,
  MonitorToggleInput,
  MonitorUpdateInput,
  MonitorWithEvaluator,
} from "./monitor.ts";

/**
 * Everything a door may ask about a project's online evaluations.
 *
 * The two doors — the wizard's `monitors.*` procedures and the
 * `/api/monitors` family — ask different questions in different shapes, but
 * every rule about a monitor is answered here once.
 */
export interface MonitorApi {
  /** Every monitor configured on the project, with its evaluator. */
  list(input: { projectId: string }): Promise<MonitorWithEvaluator[]>;
  /** One monitor. Throws `MonitorNotFoundError` when the project has none. */
  getById(input: MonitorIdInput): Promise<MonitorWithEvaluator>;
  /** One monitor, or `undefined` when the project has none. */
  findById(input: MonitorIdInput): Promise<MonitorWithEvaluator | undefined>;
  isNameAvailable(input: MonitorNameAvailabilityInput): Promise<{ available: boolean }>;
  /** Refuses by name when this check cannot run; answers nothing when it can. */
  assertCheckRunnable(input: MonitorRunnableCheckInput): Promise<void>;
  create(input: MonitorCreateInput): Promise<Monitor>;
  update(input: MonitorUpdateInput): Promise<Monitor>;
  /** Applies a partial change, keeping every field the caller did not mention. */
  patch(input: MonitorPatchInput): Promise<Monitor>;
  upsertForExperiment(input: MonitorExperimentUpsertInput): Promise<Monitor>;
  toggle(input: MonitorToggleInput): Promise<{ success: true }>;
  delete(input: MonitorIdInput): Promise<{ success: true }>;
  getEnabledOnMessageMonitors(projectId: string): Promise<MonitorSummary[]>;
  listEnabledGuardrailMonitors(
    input: MonitorEnabledGuardrailInput,
  ): Promise<EnabledGuardrailMonitor[]>;
  getAllByIds(input: { monitorIds: string[]; projectId: string }): Promise<Monitor[]>;
  deleteForExperiment(input: { projectId: string; experimentId: string }): Promise<void>;
  /** Copies the configuration into another project, evaluator and all. */
  copy(input: MonitorCopyInput): Promise<Monitor>;
  /** The copy itself, once the evaluator (if any) already exists in the target. */
  replicate(input: MonitorReplicationInput): Promise<Monitor>;
  /** The last seven days of score and pass rate for each of the project's monitors. */
  performanceForProject(input: MonitorPerformanceInput): Promise<OnlineEvaluationPerformance[]>;
}

export const MonitorApi = moduleApi<MonitorApi>("monitor");
