import { SimulationRunStatus } from "@langwatch/scenario-contract";

export const CANCELLABLE_STATUSES = new Set<SimulationRunStatus>([
  SimulationRunStatus.QUEUED,
  SimulationRunStatus.PENDING,
  SimulationRunStatus.IN_PROGRESS,
]);

export function isCancellableStatus(status: SimulationRunStatus): boolean {
  return CANCELLABLE_STATUSES.has(status);
}
