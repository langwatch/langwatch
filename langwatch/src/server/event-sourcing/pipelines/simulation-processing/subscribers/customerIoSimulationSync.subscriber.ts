/**
 * NOT WIRED — nothing constructs this factory, and this file is inert.
 *
 * Customer.io nurture has no live path at all. The reactor this replaces never
 * ran either, and has since been deleted, so there is nothing else to read for
 * "what actually happens today": nothing does. See the note in
 * `pipelineRegistry.registerAll()` for the counting-strategy question that has
 * to be settled first.
 *
 * Mounting it, once that lands, is one line on
 * `simulation-processing/pipeline.ts`:
 * `.withEventSubscriber("customerIoSimulationSync", createCustomerIoSimulationSyncSubscriber({…}))`,
 * built from the pipeline's own `Deps` per ADR-077 Rule 1.
 */

import { createLogger } from "@langwatch/observability";
import type { NurturingService } from "@ee/billing/nurturing/nurturing.service";
import type { ProjectService } from "~/server/app-layer/projects/project.service";
import { captureException, toError } from "~/utils/posthogErrorCapture";
import type {
  EventSubscriberContext,
  EventSubscriberDefinition,
} from "../../../subscribers/eventSubscriber.types";
import {
  CIO_SYNC_DEBOUNCE_TTL_MS,
  nurtureFireAndForget,
  priorNurtureCount,
} from "../../shared/nurtureSync";
import { SIMULATION_RUN_EVENT_TYPES } from "../schemas/constants";
import type { SimulationProcessingEvent } from "../schemas/events";
import { isSimulationRunFinishedEvent } from "../schemas/events";

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
 * ADR-075 Class B: syncs simulation milestones and metrics to Customer.io.
 *
 * Marketing nurture data — lossy by contract. Every Customer.io call is
 * fire-and-forget, and the handler never throws.
 *
 * This one is a straight conversion: the reactor never read `context.foldState`,
 * so the subscriber needs no projection read at all — everything it sends comes
 * from the event, the project service and the org-wide count function.
 *
 * Only fires on finished events (terminal state).
 *
 * First simulation (org has no prior simulation runs):
 *   - Identifies user with has_simulations, simulation_count: 1, first_simulation_at
 *   - Tracks "first_simulation_ran" event
 *
 * Subsequent simulations:
 *   - Identifies user with simulation_count, last_simulation_at
 */
export function createCustomerIoSimulationSyncSubscriber(
  deps: CustomerIoSimulationSyncSubscriberDeps,
): EventSubscriberDefinition<SimulationProcessingEvent> {
  return {
    name: "customerIoSimulationSync",
    // The reactor's terminal-state guard, expressed as the event-type
    // narrowing it always was: a pure `event.type === x` comparison, total and
    // non-throwing, so it is safe at the enqueue seam (ADR-075's migration
    // hazard — `filter` fails LOST where `shouldReact` failed open).
    eventTypes: [SIMULATION_RUN_EVENT_TYPES.FINISHED],
    options: {
      // The reactor's `makeJobId` + `ttl` verbatim: one Customer.io sync per
      // project per 5 minutes. `extend`/`replace` stay at their defaults (both
      // true), matching what the reactor's ttl resolved to.
      deduplication: {
        makeId: (event) => `cio-sim-sync-${event.tenantId}`,
        ttlMs: CIO_SYNC_DEBOUNCE_TTL_MS,
      },
    },

    async handle(
      event: SimulationProcessingEvent,
      context: EventSubscriberContext,
    ): Promise<void> {
      // Re-checked in the handler, not only via `eventTypes`: during a rolling
      // deploy a job staged by a build with a wider event list can still be in
      // the queue.
      if (!isSimulationRunFinishedEvent(event)) {
        return;
      }

      const projectId = context.tenantId;

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
        const existingCount = priorNurtureCount(rawCount);
        const isFirstSimulation = existingCount === 0;

        if (isFirstSimulation) {
          // Fire-and-forget: do not block the subscriber's lane
          nurtureFireAndForget({
            promise: deps.nurturing.identifyUser({
              userId,
              traits: {
                has_simulations: true,
                simulation_count: 1,
                first_simulation_at: now,
              },
            }),
            logger,
            projectId,
            what: "identify user for first simulation",
          });
          nurtureFireAndForget({
            promise: deps.nurturing.trackEvent({
              userId,
              event: "first_simulation_ran",
              properties: {
                project_id: projectId,
              },
            }),
            logger,
            projectId,
            what: "track first_simulation_ran event",
          });
        } else {
          const newCount = existingCount + 1;
          // Fire-and-forget: do not block the subscriber's lane
          nurtureFireAndForget({
            promise: deps.nurturing.identifyUser({
              userId,
              traits: {
                simulation_count: newCount,
                last_simulation_at: now,
              },
            }),
            logger,
            projectId,
            what: "identify user for simulation update",
          });
        }
      } catch (error) {
        // Class B is lossy by contract: never throw back into the queue.
        logger.error(
          { projectId, error },
          "Failed to process CIO simulation sync — non-fatal",
        );
        captureException(toError(error));
      }
    },
  };
}
