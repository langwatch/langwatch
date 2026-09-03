import type {
  MonitorIdInput,
  MonitorNameAvailabilityInput,
  MonitorReplicationInput,
  MonitorToggleInput,
} from "./monitor";

export type { MonitorCreateInput, MonitorUpdateInput } from "./monitor";
export type MonitorToggleCommand = MonitorToggleInput;
export type MonitorDeleteCommand = MonitorIdInput;
export type MonitorGetCommand = MonitorIdInput;
export type MonitorNameAvailabilityQuery = MonitorNameAvailabilityInput;
export type MonitorReplicationCommand = MonitorReplicationInput;
