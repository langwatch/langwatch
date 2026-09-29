import type { NurturingApi } from "@langwatch/enterprise-nurturing-contract";
import type { SubscriberSpec } from "@langwatch/eventing";
import type { ProjectApi } from "@langwatch/project-contract";
import {
  SIMULATION_RUN_EVENT_TYPES,
  type SimulationProcessingEvent,
  type SimulationService,
} from "@langwatch/scenario-contract";

export interface SimulationRunFinishedNurturingDeps {
  projects: Pick<ProjectApi, "resolveOrgAdmin" | "listIdsByOrganization">;
  simulations: Pick<SimulationService, "countUsage">;
  nurturing: Pick<NurturingApi, "recordSignal">;
}

/**
 * Tells nurturing every finished run, against the admin, counted across the
 * organization's projects, this one included (main's customerIoSimulationSync).
 */
export function createSimulationRunFinishedNurturingSubscriber(
  deps: SimulationRunFinishedNurturingDeps,
): SubscriberSpec<SimulationProcessingEvent> & { fold?: never; map?: never } {
  return {
    events: [SIMULATION_RUN_EVENT_TYPES.FINISHED],
    async handler(event: SimulationProcessingEvent): Promise<void> {
      const projectId = String(event.tenantId);
      const { userId, organizationId } = await deps.projects.resolveOrgAdmin(projectId);
      if (!userId || !organizationId) return;

      const projectIds = await deps.projects.listIdsByOrganization({ organizationId });
      const organizationRunCount = await deps.simulations.countUsage({ projectIds });
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
