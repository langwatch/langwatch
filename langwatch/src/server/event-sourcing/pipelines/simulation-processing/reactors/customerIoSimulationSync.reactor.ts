import type { NurturingService } from "../../../../../../ee/billing/nurturing/nurturing.service";
import type { ProjectService } from "../../../../app-layer/projects/project.service";
import { CIO_REACTOR_DEBOUNCE_TTL_MS } from "../../trace-processing/reactors/customerIoTraceSync.reactor";
import { createLogger } from "../../../../../utils/logger/server";
import { captureException } from "../../../../../utils/posthogErrorCapture";
import type { ReactorContext, ReactorDefinition } from "../../../reactors/reactor.types";
import type { SimulationRunStateData } from "../projections/simulationRunState.foldProjection";
import type { SimulationProcessingEvent } from "../schemas/events";
import { isSimulationRunFinishedEvent } from "../schemas/events";

const logger = createLogger(
  "langwatch:simulation-processing:customer-io-simulation-sync-reactor",
);

export interface CustomerIoSimulationSyncReactorDeps {
  projects: ProjectService;
  nurturing: NurturingService;
  /** Returns the count of existing finished simulation runs for the org, or null on failure. */
  simulationCountFn: (organizationId: string) => Promise<number | null>;
}

/**
 * Reactor that syncs simulation milestones and metrics to Customer.io.
 *
 * Registered on the simulation_processing pipeline after the simulationRunState fold.
 *
 * Only fires on finished events (terminal state).
 *
 * First simulation (org has no prior simulation runs):
 *   - Identifies user with has_simulations, simulation_count: 1, first_simulation_at
 *   - Tracks "first_simulation_ran" event
 *
 * Subsequent simulations:
 *   - Identifies user with simulation_count, last_simulation_at
 *   - Debounced via makeJobId with 5-minute TTL
 *
 * All nurturing calls are fire-and-forget with captureException.
 */
export function createCustomerIoSimulationSyncReactor(
  deps: CustomerIoSimulationSyncReactorDeps,
): ReactorDefinition<SimulationProcessingEvent, SimulationRunStateData> {
  return {
    name: "customerIoSimulationSync",
    options: {
      makeJobId: (payload) =>
        `cio-sim-sync-${payload.event.tenantId}`,
      ttl: CIO_REACTOR_DEBOUNCE_TTL_MS,
    },

    async handle(
      event: SimulationProcessingEvent,
      context: ReactorContext<SimulationRunStateData>,
    ): Promise<void> {
      // Only sync on terminal events
      if (!isSimulationRunFinishedEvent(event)) {
        return;
      }

      const { tenantId: projectId } = context;

      try {
        const { userId, organizationId } = await deps.projects.resolveOrgAdmin(projectId);

        if (!userId || !organizationId) {
          logger.warn(
            { projectId },
            "No admin user found for project — skipping CIO simulation sync",
          );
          return;
        }

        const now = new Date(event.occurredAt).toISOString();

        const rawCount = await deps.simulationCountFn(organizationId);
        if (rawCount === null) {
          logger.warn(
            { projectId },
            "Could not determine simulation count — skipping CIO simulation sync",
          );
          return;
        }
        // The fold projection persists before reactors fire, so the current
        // simulation is already counted — subtract 1 to get prior count.
        const existingCount = Math.max(0, rawCount - 1);
        const isFirstSimulation = existingCount === 0;

        if (isFirstSimulation) {
          // Fire-and-forget: do not block reactor processing
          void deps.nurturing
            .identifyUser({ userId, traits: {
              has_simulations: true,
              simulation_count: 1,
              first_simulation_at: now,
            }})
            .catch((error) => {
              logger.error({ projectId, error }, "Failed to identify user for first simulation");
              captureException(error);
            });
          void deps.nurturing
            .trackEvent({ userId, event: "first_simulation_ran", properties: {
              project_id: projectId,
            }})
            .catch((error) => {
              logger.error({ projectId, error }, "Failed to track first_simulation_ran event");
              captureException(error);
            });
        } else {
          const newCount = existingCount + 1;
          // Fire-and-forget: do not block reactor processing
          void deps.nurturing
            .identifyUser({ userId, traits: {
              simulation_count: newCount,
              last_simulation_at: now,
            }})
            .catch((error) => {
              logger.error({ projectId, error }, "Failed to identify user for simulation update");
              captureException(error);
            });
        }
      } catch (error) {
        logger.error(
          { projectId, error },
          "Failed to process CIO simulation sync — non-fatal",
        );
        captureException(error);
      }
    },
  };
}
