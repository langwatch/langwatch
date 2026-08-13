import { createLogger } from "@langwatch/observability";
import type { NurturingService } from "../../../../../../ee/billing/nurturing/nurturing.service";
import {
  captureException,
  toError,
} from "../../../../../utils/posthogErrorCapture";
import type { ProjectService } from "../../../../app-layer/projects/project.service";
import type { SubscriberSpec } from "../../../pipeline/processManagerDefinition";
import { SIMULATION_RUN_EVENT_TYPES } from "../schemas/constants";
import type {
  SimulationProcessingEvent,
  SimulationRunFinishedEvent,
} from "../schemas/events";
import { isSimulationRunFinishedEvent } from "../schemas/events";
import { CIO_SYNC_DEBOUNCE_TTL_MS } from "../../trace-processing/subscribers/customerIoTraceSync.subscriber";

const logger = createLogger(
  "langwatch:simulation-processing:customer-io-simulation-sync-subscriber",
);

export interface CustomerIoSimulationSyncSubscriberDeps {
  projects: ProjectService;
  nurturing: NurturingService;
  /** Returns the count of existing finished simulation runs for the org, or null on failure. */
  simulationCountFn: (organizationId: string) => Promise<number | null>;
}

/**
 * Subscriber that syncs simulation milestones and metrics to Customer.io.
 *
 * Attached to the simulationRunState fold for sequencing only: the handler
 * fires after the fold commits, so the run count below already includes the
 * current simulation. The handler itself only uses the event + services.
 *
 * Only fires on finished events (terminal state).
 *
 * First simulation (org has no prior simulation runs):
 *   - Identifies user with has_simulations, simulation_count: 1, first_simulation_at
 *   - Tracks "first_simulation_ran" event
 *
 * Subsequent simulations:
 *   - Identifies user with simulation_count, last_simulation_at
 *   - Debounced via dedupId with 5-minute TTL
 *
 * All nurturing calls are fire-and-forget with captureException.
 */
export function createCustomerIoSimulationSyncSubscriber(
  deps: CustomerIoSimulationSyncSubscriberDeps,
): SubscriberSpec<SimulationProcessingEvent> & { fold: "simulationRunState" } {
  return {
    fold: "simulationRunState",
    events: [SIMULATION_RUN_EVENT_TYPES.FINISHED],
    dedupId: (event) => `cio-sim-sync-${event.tenantId}`,
    ttl: CIO_SYNC_DEBOUNCE_TTL_MS,

    async handler(event: SimulationProcessingEvent): Promise<void> {
      // Only sync on terminal events
      if (!isSimulationRunFinishedEvent(event)) {
        return;
      }

      await syncFinishedSimulation(deps, event);
    },
  };
}

async function syncFinishedSimulation(
  deps: CustomerIoSimulationSyncSubscriberDeps,
  event: SimulationRunFinishedEvent,
): Promise<void> {
  const projectId = String(event.tenantId);

  try {
    const { userId, organizationId } =
      await deps.projects.resolveOrgAdmin(projectId);

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
    // The fold projection persists before subscribers fire, so the current
    // simulation is already counted — subtract 1 to get prior count.
    const existingCount = Math.max(0, rawCount - 1);
    const isFirstSimulation = existingCount === 0;

    if (isFirstSimulation) {
      trackFirstSimulation(deps, { projectId, userId, now });
    } else {
      identifySubsequentSimulation(deps, {
        projectId,
        userId,
        now,
        newCount: existingCount + 1,
      });
    }
  } catch (error) {
    logger.error(
      { projectId, error },
      "Failed to process CIO simulation sync — non-fatal",
    );
    captureException(toError(error));
  }
}

/** Fire-and-forget: do not block subscriber processing. */
function trackFirstSimulation(
  deps: CustomerIoSimulationSyncSubscriberDeps,
  {
    projectId,
    userId,
    now,
  }: { projectId: string; userId: string; now: string },
): void {
  void deps.nurturing
    .identifyUser({
      userId,
      traits: {
        has_simulations: true,
        simulation_count: 1,
        first_simulation_at: now,
      },
    })
    .catch((error) => {
      logger.error(
        { projectId, error },
        "Failed to identify user for first simulation",
      );
      captureException(toError(error));
    });
  void deps.nurturing
    .trackEvent({
      userId,
      event: "first_simulation_ran",
      properties: {
        project_id: projectId,
      },
    })
    .catch((error) => {
      logger.error(
        { projectId, error },
        "Failed to track first_simulation_ran event",
      );
      captureException(toError(error));
    });
}

/** Fire-and-forget: do not block subscriber processing. */
function identifySubsequentSimulation(
  deps: CustomerIoSimulationSyncSubscriberDeps,
  {
    projectId,
    userId,
    now,
    newCount,
  }: { projectId: string; userId: string; now: string; newCount: number },
): void {
  void deps.nurturing
    .identifyUser({
      userId,
      traits: {
        simulation_count: newCount,
        last_simulation_at: now,
      },
    })
    .catch((error) => {
      logger.error(
        { projectId, error },
        "Failed to identify user for simulation update",
      );
      captureException(toError(error));
    });
}
