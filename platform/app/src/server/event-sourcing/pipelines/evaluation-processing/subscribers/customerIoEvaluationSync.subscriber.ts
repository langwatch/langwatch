import { createLogger } from "@langwatch/observability";
import type { EvaluationRunData } from "~/server/app-layer/evaluations/types";
import type { NurturingService } from "../../../../../../ee/billing/nurturing/nurturing.service";
import {
  captureException,
  toError,
} from "../../../../../utils/posthogErrorCapture";
import type { ProjectService } from "../../../../app-layer/projects/project.service";
import type {
  SubscriberSpec,
  TriggerContext,
} from "../../../pipeline/processManagerDefinition";
import { CIO_SYNC_DEBOUNCE_TTL_MS } from "../../trace-processing/subscribers/customerIoTraceSync.subscriber";
import {
  EVALUATION_COMPLETED_EVENT_TYPE,
  EVALUATION_REPORTED_EVENT_TYPE,
} from "../schemas/constants";
import type { EvaluationProcessingEvent } from "../schemas/events";
import {
  isEvaluationCompletedEvent,
  isEvaluationReportedEvent,
} from "../schemas/events";

const logger = createLogger(
  "langwatch:evaluation-processing:customer-io-evaluation-sync",
);

export interface CustomerIoEvaluationSyncSubscriberDeps {
  projects: ProjectService;
  nurturing: NurturingService;
  /** Returns the count of existing completed evaluations for the org, or null on failure. */
  evaluationCountFn: (organizationId: string) => Promise<number | null>;
}

/**
 * Subscriber that syncs evaluation milestones and metrics to Customer.io.
 *
 * Offered on the evaluation_processing pipeline after the evaluationRun fold;
 * not registered yet — the counting strategy needs finalising before enabling.
 *
 * Only fires on completed or reported events (terminal states).
 *
 * First evaluation (org has no prior evaluations):
 *   - Identifies user with has_evaluations, evaluation_count: 1, first_evaluation_at
 *   - Tracks "first_evaluation_created" event
 *
 * Subsequent evaluations:
 *   - Identifies user with evaluation_count, last_evaluation_at
 *   - Debounced via dedupId with 5-minute TTL
 *
 * Every evaluation (first and subsequent):
 *   - Tracks "evaluation_ran" event
 *
 * All nurturing calls are fire-and-forget with captureException.
 */
export function createCustomerIoEvaluationSyncSubscriber(
  deps: CustomerIoEvaluationSyncSubscriberDeps,
): SubscriberSpec<EvaluationProcessingEvent> & { fold: "evaluationRun" } {
  return {
    fold: "evaluationRun",
    events: [EVALUATION_COMPLETED_EVENT_TYPE, EVALUATION_REPORTED_EVENT_TYPE],
    dedupId: (event) => `cio-eval-sync-${event.tenantId}-${event.aggregateId}`,
    ttl: CIO_SYNC_DEBOUNCE_TTL_MS,

    async handler(
      event: EvaluationProcessingEvent,
      context: TriggerContext<EvaluationRunData>,
    ): Promise<void> {
      // Only sync on terminal events
      if (
        !isEvaluationCompletedEvent(event) &&
        !isEvaluationReportedEvent(event)
      ) {
        return;
      }

      await syncTerminalEvaluation(deps, {
        projectId: context.tenantId,
        foldState: context.state,
        occurredAt: event.occurredAt,
      });
    },
  };
}

async function syncTerminalEvaluation(
  deps: CustomerIoEvaluationSyncSubscriberDeps,
  {
    projectId,
    foldState,
    occurredAt,
  }: { projectId: string; foldState: EvaluationRunData; occurredAt: number },
): Promise<void> {
  try {
    const { userId, organizationId } =
      await deps.projects.resolveOrgAdmin(projectId);

    if (!userId || !organizationId) {
      logger.warn(
        { projectId },
        "No admin user found for project — skipping CIO evaluation sync",
      );
      return;
    }

    const now = new Date(occurredAt).toISOString();

    const rawCount = await deps.evaluationCountFn(organizationId);
    if (rawCount === null) {
      logger.warn(
        { projectId },
        "Could not determine evaluation count — skipping CIO evaluation sync",
      );
      return;
    }
    // The fold projection persists before subscribers fire, so the current
    // evaluation is already counted — subtract 1 to get prior count.
    const existingCount = Math.max(0, rawCount - 1);

    if (existingCount === 0) {
      trackFirstEvaluation(deps, { projectId, userId, now, foldState });
    } else {
      identifySubsequentEvaluation(deps, {
        projectId,
        userId,
        now,
        newCount: existingCount + 1,
      });
    }

    trackEvaluationRan(deps, { projectId, userId, foldState });
  } catch (error) {
    logger.error(
      { projectId, error },
      "Failed to process CIO evaluation sync — non-fatal",
    );
    captureException(toError(error));
  }
}

/** Fire-and-forget: do not block subscriber processing. */
function trackFirstEvaluation(
  deps: CustomerIoEvaluationSyncSubscriberDeps,
  {
    projectId,
    userId,
    now,
    foldState,
  }: {
    projectId: string;
    userId: string;
    now: string;
    foldState: EvaluationRunData;
  },
): void {
  void deps.nurturing
    .identifyUser({
      userId,
      traits: {
        has_evaluations: true,
        evaluation_count: 1,
        first_evaluation_at: now,
      },
    })
    .catch((error) => {
      logger.error(
        { projectId, error },
        "Failed to identify user for first evaluation",
      );
      captureException(toError(error));
    });
  void deps.nurturing
    .trackEvent({
      userId,
      event: "first_evaluation_created",
      properties: {
        evaluation_type: foldState.evaluatorType,
        project_id: projectId,
      },
    })
    .catch((error) => {
      logger.error(
        { projectId, error },
        "Failed to track first_evaluation_created event",
      );
      captureException(toError(error));
    });
}

/** Fire-and-forget: do not block subscriber processing. */
function identifySubsequentEvaluation(
  deps: CustomerIoEvaluationSyncSubscriberDeps,
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
        evaluation_count: newCount,
        last_evaluation_at: now,
      },
    })
    .catch((error) => {
      logger.error(
        { projectId, error },
        "Failed to identify user for evaluation update",
      );
      captureException(toError(error));
    });
}

/** Tracked for every evaluation, first and subsequent. Fire-and-forget. */
function trackEvaluationRan(
  deps: CustomerIoEvaluationSyncSubscriberDeps,
  {
    projectId,
    userId,
    foldState,
  }: { projectId: string; userId: string; foldState: EvaluationRunData },
): void {
  void deps.nurturing
    .trackEvent({
      userId,
      event: "evaluation_ran",
      properties: {
        evaluation_id: foldState.evaluationId,
        score: foldState.score,
        passed: foldState.passed,
      },
    })
    .catch((error) => {
      logger.error(
        { projectId, error },
        "Failed to track evaluation_ran event",
      );
      captureException(toError(error));
    });
}
