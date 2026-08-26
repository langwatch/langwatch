/** One process manager's registry identity joined to its live trouble counts. */
export interface ProcessFleetSummary {
  processName: string;
  pipelineName: string;
  scheduled: boolean;
  instances: number;
  overdueWakes: number;
  pendingMessages: number;
  overduePending: number;
  lapsedLeases: number;
  deadMessages: number;
}
