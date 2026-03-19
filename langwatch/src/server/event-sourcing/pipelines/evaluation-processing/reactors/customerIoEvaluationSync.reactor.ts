import type { NurturingService } from "../../../../../../ee/billing/nurturing/nurturing.service";
import type { ProjectService } from "../../../../app-layer/projects/project.service";
import { CIO_REACTOR_DEBOUNCE_TTL_MS } from "../../trace-processing/reactors/customerIoTraceSync.reactor";
import { createLogger } from "../../../../../utils/logger/server";
import { captureException } from "../../../../../utils/posthogErrorCapture";
import type { ReactorContext, ReactorDefinition } from "../../../reactors/reactor.types";
import type { EvaluationRunData } from "~/server/app-layer/evaluations/types";
import type { EvaluationProcessingEvent } from "../schemas/events";
import { isEvaluationCompletedEvent, isEvaluationReportedEvent } from "../schemas/events";

const logger = createLogger(
  "langwatch:evaluation-processing:customer-io-evaluation-sync-reactor",
);

export interface CustomerIoEvaluationSyncReactorDeps {
  projects: ProjectService;
  nurturing: NurturingService;
  /** Returns the count of existing completed evaluations for the org, or null on failure. */
  evaluationCountFn: (organizationId: string) => Promise<number | null>;
}

/**
 * Reactor that syncs evaluation milestones and metrics to Customer.io.
 *
 * Registered on the evaluation_processing pipeline after the evaluationRun fold.
 *
 * Only fires on completed or reported events (terminal states).
 *
 * First evaluation (org has no prior evaluations):
 *   - Identifies user with has_evaluations, evaluation_count: 1, first_evaluation_at
 *   - Tracks "first_evaluation_created" event
 *
 * Subsequent evaluations:
 *   - Identifies user with evaluation_count, last_evaluation_at
 *   - Tracks "evaluation_ran" event
 *   - Debounced via makeJobId with 5-minute TTL
 *
 * All nurturing calls are fire-and-forget with captureException.
 */
export function createCustomerIoEvaluationSyncReactor(
  deps: CustomerIoEvaluationSyncReactorDeps,
): ReactorDefinition<EvaluationProcessingEvent, EvaluationRunData> {
  return {
    name: "customerIoEvaluationSync",
    options: {
      makeJobId: (payload) =>
        `cio-eval-sync-${payload.event.tenantId}-${payload.event.aggregateId}`,
      ttl: CIO_REACTOR_DEBOUNCE_TTL_MS,
    },

    async handle(
      event: EvaluationProcessingEvent,
      context: ReactorContext<EvaluationRunData>,
    ): Promise<void> {
      // Only sync on terminal events
      if (!isEvaluationCompletedEvent(event) && !isEvaluationReportedEvent(event)) {
        return;
      }

      const { tenantId: projectId, foldState } = context;

      try {
        const { userId, organizationId } = await deps.projects.resolveOrgAdmin(projectId);

        if (!userId || !organizationId) {
          logger.warn(
            { projectId },
            "No admin user found for project — skipping CIO evaluation sync",
          );
          return;
        }

        const now = new Date(event.occurredAt).toISOString();

        const rawCount = await deps.evaluationCountFn(organizationId);
        if (rawCount === null) {
          logger.warn(
            { projectId },
            "Could not determine evaluation count — skipping CIO evaluation sync",
          );
          return;
        }
        // The fold projection persists before reactors fire, so the current
        // evaluation is already counted — subtract 1 to get prior count.
        const existingCount = Math.max(0, rawCount - 1);
        const isFirstEvaluation = existingCount === 0;

        if (isFirstEvaluation) {
          // Fire-and-forget: do not block reactor processing
          void deps.nurturing
            .identifyUser({ userId, traits: {
              has_evaluations: true,
              evaluation_count: 1,
              first_evaluation_at: now,
            }})
            .catch((error) => {
              logger.error({ projectId, error }, "Failed to identify user for first evaluation");
              captureException(error);
            });
          void deps.nurturing
            .trackEvent({ userId, event: "first_evaluation_created", properties: {
              evaluation_type: foldState.evaluatorType,
              project_id: projectId,
            }})
            .catch((error) => {
              logger.error({ projectId, error }, "Failed to track first_evaluation_created event");
              captureException(error);
            });
        } else {
          const newCount = existingCount + 1;
          // Fire-and-forget: do not block reactor processing
          void deps.nurturing
            .identifyUser({ userId, traits: {
              evaluation_count: newCount,
              last_evaluation_at: now,
            }})
            .catch((error) => {
              logger.error({ projectId, error }, "Failed to identify user for evaluation update");
              captureException(error);
            });
        }

        // Track evaluation_ran for every evaluation (first and subsequent)
        void deps.nurturing
          .trackEvent({ userId, event: "evaluation_ran", properties: {
            evaluation_id: foldState.evaluationId,
            score: foldState.score,
            passed: foldState.passed,
          }})
          .catch((error) => {
            logger.error({ projectId, error }, "Failed to track evaluation_ran event");
            captureException(error);
          });
      } catch (error) {
        logger.error(
          { projectId, error },
          "Failed to process CIO evaluation sync — non-fatal",
        );
        captureException(error);
      }
    },
  };
}
