import { featureApi } from "@langwatch/runtime-composition";
import type {
  Monitor,
  MonitorCreateInput,
  MonitorExperimentUpsertInput,
  MonitorIdInput,
  MonitorNameAvailabilityInput,
  MonitorToggleInput,
  MonitorUpdateInput,
  MonitorWithEvaluator,
  MonitorEnabledGuardrailInput,
  MonitorReplicationInput,
} from "./monitor.ts";

export interface MonitorApi {
  list(input: { projectId: string }): Promise<MonitorWithEvaluator[]>;
  getById(input: MonitorIdInput): Promise<MonitorWithEvaluator>;
  tryGetById(input: MonitorIdInput): Promise<MonitorWithEvaluator | null>;
  isNameAvailable(input: MonitorNameAvailabilityInput): Promise<{ available: boolean }>;
  create(input: MonitorCreateInput): Promise<Monitor>;
  update(input: MonitorUpdateInput): Promise<Monitor>;
  upsertForExperiment(input: MonitorExperimentUpsertInput): Promise<Monitor>;
  toggle(input: MonitorToggleInput): Promise<{ success: true }>;
  delete(input: MonitorIdInput): Promise<{ success: true }>;
  getEnabledOnMessageMonitors(projectId: string): Promise<unknown[]>;
  listEnabledGuardrailMonitors(input: MonitorEnabledGuardrailInput): Promise<unknown[]>;
  getAllByIds(input: { monitorIds: string[]; projectId: string }): Promise<Monitor[]>;
  deleteForExperiment(input: { projectId: string; experimentId: string }): Promise<void>;
  replicate(input: MonitorReplicationInput): Promise<Monitor>;
}

export const MonitorApi = featureApi<MonitorApi>("monitor");
