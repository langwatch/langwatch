import type { NurturingApi } from "@langwatch/enterprise-nurturing-contract";
import { throttledWindow, type SubscriberSpec } from "@langwatch/eventing";
import type { ProjectApi } from "@langwatch/project-contract";
import {
  SIMULATION_RUN_EVENT_TYPES,
  type SimulationProcessingEvent,
  type SimulationService,
} from "@langwatch/scenario-contract";

export interface SimulationRunFinishedNurturingDeps {
  projects: Pick<ProjectApi, "resolveOrgAdmin" | "listIdsByOrganization">;
  simulations: Pick<SimulationService, "countOrganizationRuns">;
  nurturing: Pick<NurturingApi, "recordSignal">;
}

/** Main's CIO_SYNC_DEBOUNCE_TTL_MS: the organization's count reads one row per project. */
export const SIMULATION_RUN_FINISHED_NURTURING_WINDOW_MS = 300_000;

/** One lane and one debounce key per project, as project-metadata.subscriber.ts keys its own. */
export function simulationRunFinishedNurturingKey(event: { tenantId: string }): string {
  return `simulation-run-finished-nurturing:${event.tenantId}`;
}

/**
 * Tells nurturing a project's first finished run at once, then at most once per
 * window, against the admin, with the organization's run count read in one query
 * (main's customerIoSimulationSync and its debounce).
 */
export function createSimulationRunFinishedNurturingSubscriber(
  deps: SimulationRunFinishedNurturingDeps,
): SubscriberSpec<SimulationProcessingEvent> & { fold?: never; map?: never } {
  return {
    events: [SIMULATION_RUN_EVENT_TYPES.FINISHED],
    groupKeyFn: (event) => simulationRunFinishedNurturingKey(event),
    ...throttledWindow<SimulationProcessingEvent>({
      makeId: (event) => simulationRunFinishedNurturingKey(event),
      windowMs: 0,
      dedupTtlMs: SIMULATION_RUN_FINISHED_NURTURING_WINDOW_MS,
      shouldSurviveDispatch: true,
    }),
    async handler(event: SimulationProcessingEvent): Promise<void> {
      const projectId = String(event.tenantId);
      const { userId, organizationId } = await deps.projects.resolveOrgAdmin(projectId);
      if (!userId || !organizationId) return;

      const projectIds = await deps.projects.listIdsByOrganization({ organizationId });
      const organizationRunCount = await deps.simulations.countOrganizationRuns({ projectIds });
      if (organizationRunCount < 1) return;

      await deps.nurturing.recordSignal({
        kind: "simulation_run_finished",
        sourceEventId: event.id,
        tenantId: projectId,
        occurredAt: event.occurredAt,
        userId,
        projectId,
        organizationRunCount,
      });
    },
  };
}
