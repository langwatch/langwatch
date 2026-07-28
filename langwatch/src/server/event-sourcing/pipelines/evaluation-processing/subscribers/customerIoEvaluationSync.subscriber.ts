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
 * `evaluation-processing/pipeline.ts`:
 * `.withEventSubscriber("customerIoEvaluationSync", createCustomerIoEvaluationSyncSubscriber({…}))`,
 * built from the pipeline's own `Deps` per ADR-077 Rule 1.
 */

import { createLogger } from "@langwatch/observability";
import type { NurturingService } from "@ee/billing/nurturing/nurturing.service";
import type { EvaluationRunData } from "~/server/app-layer/evaluations/types";
import type { ProjectService } from "~/server/app-layer/projects/project.service";
import { createTenantId } from "~/server/event-sourcing/domain/tenantId";
import type { FoldProjectionStore } from "~/server/event-sourcing/projections/foldProjection.types";
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
  "langwatch:evaluation-processing:customer-io-evaluation-sync-subscriber",
);

export interface CustomerIoEvaluationSyncSubscriberDeps {
  projects: ProjectService;
  nurturing: NurturingService;
  /** Returns the count of existing completed evaluations for the org, or null on failure. */
  evaluationCountFn: (organizationId: string) => Promise<number | null>;
  /**
   * ADR-075: a subscriber receives no fold state, so the committed
   * evaluationRun row is read back here. `evaluatorType` is only carried by
   * the `reported` event — a `completed` event does not have it, it is folded
   * in from the earlier `scheduled`/`started` event — so the fold is the only
   * total source for the traits this subscriber sends. The read is I/O and so
   * belongs in the handler, not at the enqueue seam.
   */
  evalRunStore: FoldProjectionStore<EvaluationRunData>;
}

/**
 * ADR-075 Class B: syncs evaluation milestones and metrics to Customer.io.
 *
 * Marketing nurture data — lossy by contract. Every Customer.io call is
 * fire-and-forget, and the handler never throws.
 *
 * Only fires on completed or reported events (terminal states).
 *
 * First evaluation (org has no prior evaluations):
 *   - Identifies user with has_evaluations, evaluation_count: 1, first_evaluation_at
 *   - Tracks "first_evaluation_created" event
 *
 * Subsequent evaluations:
 *   - Identifies user with evaluation_count, last_evaluation_at
 *
 * Every evaluation (first and subsequent):
 *   - Tracks "evaluation_ran" event
 */
export function createCustomerIoEvaluationSyncSubscriber(
  deps: CustomerIoEvaluationSyncSubscriberDeps,
): EventSubscriberDefinition<EvaluationProcessingEvent> {
  return {
    name: "customerIoEvaluationSync",
    // The reactor's terminal-state guard, expressed as the event-type
    // narrowing it always was: a pure `event.type === x` comparison, which is
    // total and cannot throw, so it is safe at the enqueue seam (ADR-075's
    // migration hazard — `filter` fails LOST where `shouldReact` failed open).
    eventTypes: [EVALUATION_COMPLETED_EVENT_TYPE, EVALUATION_REPORTED_EVENT_TYPE],
    options: {
      // The reactor's `makeJobId` + `ttl` verbatim: one Customer.io sync per
      // project+evaluation per 5 minutes. `extend`/`replace` stay at their
      // defaults (both true), matching what the reactor's ttl resolved to.
      deduplication: {
        makeId: (event) =>
          `cio-eval-sync-${event.tenantId}-${String(event.aggregateId)}`,
        ttlMs: CIO_SYNC_DEBOUNCE_TTL_MS,
      },
    },

    async handle(
      event: EvaluationProcessingEvent,
      context: EventSubscriberContext,
    ): Promise<void> {
      // Re-checked in the handler, not only via `eventTypes`: during a rolling
      // deploy a job staged by a build with a wider event list can still be in
      // the queue.
      if (
        !isEvaluationCompletedEvent(event) &&
        !isEvaluationReportedEvent(event)
      ) {
        return;
      }

      const projectId = context.tenantId;

      try {
        const evaluation = await deps.evalRunStore.get(context.aggregateId, {
          tenantId: createTenantId(projectId),
          aggregateId: context.aggregateId,
        });
        if (!evaluation) {
          logger.debug(
            { projectId, evaluationId: context.aggregateId },
            "Evaluation run not readable — skipping CIO evaluation sync",
          );
          return;
        }

        const { userId, organizationId } =
          await deps.projects.resolveOrgAdmin(projectId);

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
        const existingCount = priorNurtureCount(rawCount);
        const isFirstEvaluation = existingCount === 0;

        if (isFirstEvaluation) {
          // Fire-and-forget: do not block the subscriber's lane
          nurtureFireAndForget({
            promise: deps.nurturing.identifyUser({
              userId,
              traits: {
                has_evaluations: true,
                evaluation_count: 1,
                first_evaluation_at: now,
              },
            }),
            logger,
            projectId,
            what: "identify user for first evaluation",
          });
          nurtureFireAndForget({
            promise: deps.nurturing.trackEvent({
              userId,
              event: "first_evaluation_created",
              properties: {
                evaluation_type: evaluation.evaluatorType,
                project_id: projectId,
              },
            }),
            logger,
            projectId,
            what: "track first_evaluation_created event",
          });
        } else {
          const newCount = existingCount + 1;
          // Fire-and-forget: do not block the subscriber's lane
          nurtureFireAndForget({
            promise: deps.nurturing.identifyUser({
              userId,
              traits: {
                evaluation_count: newCount,
                last_evaluation_at: now,
              },
            }),
            logger,
            projectId,
            what: "identify user for evaluation update",
          });
        }

        // Track evaluation_ran for every evaluation (first and subsequent)
        nurtureFireAndForget({
          promise: deps.nurturing.trackEvent({
            userId,
            event: "evaluation_ran",
            properties: {
              evaluation_id: evaluation.evaluationId,
              score: evaluation.score,
              passed: evaluation.passed,
            },
          }),
          logger,
          projectId,
          what: "track evaluation_ran event",
        });
      } catch (error) {
        // Class B is lossy by contract: never throw back into the queue.
        logger.error(
          { projectId, error },
          "Failed to process CIO evaluation sync — non-fatal",
        );
        captureException(toError(error));
      }
    },
  };
}
