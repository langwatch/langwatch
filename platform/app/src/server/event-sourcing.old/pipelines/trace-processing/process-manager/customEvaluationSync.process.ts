import { createLogger } from "@langwatch/observability";
import type { ProcessManagerApplier } from "~/server/event-sourcing.old/pipeline/processBuilder";
import type {
  EventHandler,
  IntentSpec,
  ProcessEvolution,
  ProcessHandlerContext,
  ProcessManagerEnqueueOptions,
} from "~/server/event-sourcing.old/pipeline/processManagerDefinition";
import { customEvaluationSyncDroppedCounter } from "~/server/metrics";

import {
  SPAN_RECEIVED_EVENT_TYPE,
  STALE_TRACE_THRESHOLD_MS,
} from "../schemas/constants";
import {
  makeSpanReferencedEvent,
  parseSpanReferencedEvent,
  type SpanReceivedEvent,
  type TraceProcessingEvent,
} from "../schemas/events";
import {
  type CustomEvaluationSyncDispatchDeps,
  createCustomEvaluationReportHandler,
} from "./customEvaluationSyncIntentHandlers";
import {
  CUSTOM_EVALUATION_PAYLOAD_ATTRIBUTE,
  CUSTOM_EVALUATION_SPAN_EVENT_NAME,
  CUSTOM_EVALUATION_SYNC_INTENT_TYPES,
  CUSTOM_EVALUATION_SYNC_LEASE_DURATION_MS,
  CUSTOM_EVALUATION_SYNC_MAX_ATTEMPTS,
  type CustomEvaluationSyncEventView,
  type CustomEvaluationSyncState,
  customEvaluationReportIntentSchema,
  customEvaluationSyncEventViewSchema,
  customEvaluationSyncRetryDelayMs,
  INITIAL_CUSTOM_EVALUATION_SYNC_STATE,
  reportEvaluationsMessageKey,
} from "./customEvaluationSyncProcess.types";
import { readOtlpString, spanOf } from "./otlpEventView";

/**
 * The `customEvaluationSync` process (a process manager under ADR-098): pure
 * state logic only. The pipeline mounts these handlers; the runtime owns the
 * manager, outbox and wake workers.
 *
 * Its job is to make sure an evaluation a customer's SDK ran itself ends up
 * recorded. The verdict arrives stapled to a span as a
 * `langwatch.evaluation.custom` event and has to reach the evaluation
 * pipeline; lose the hand-off and the platform has no record of a score the
 * SDK reported, which looks exactly like an evaluation that never ran.
 *
 * The reactor this replaces already rethrew on a failed dispatch, so unlike
 * its siblings it had no swallowed failure to fix. What changes is what the
 * rethrow lands in: a delayed reactor job whose loss was invisible becomes a
 * leased outbox message committed in the same transaction as the inbox row.
 *
 * **The verdicts never cross this boundary.** The narrowing hands on the
 * span's identity and one yes/no question; the intent handler reads the span
 * back out of the span store — where `spanStorage` already wrote it once — and
 * extracts the evaluations there. That is ADR-098's claim-check, and it is
 * what lets the identity of the work be the SPAN (ADR-098: derived, never
 * minted) rather than a generation counter invented to key an outbox row.
 *
 * **Every guard that can fail stays out of these handlers.** The store read,
 * the JSON parse and the command sends are all in the intent handler, where a
 * throw re-leases the message. The only questions asked here are total ones
 * about the event itself.
 *
 * There is no deadline and no wake. Its predecessor dispatched on a five
 * second job delay; a verdict is finished when it arrives, so the report is
 * raised as the span is handled and the outbox's own backoff covers the race
 * against the sibling span write.
 *
 * ---
 *
 * **A classification note, deliberately left in place.** `isStale` below means
 * a REPLAY does not rebuild these evaluations. For genuinely dispatched work
 * that is correct — you do not re-run or re-bill on replay — and this process
 * is mounted as dispatched work (a process manager under ADR-098). But what it
 * actually does is relay a fact that is already durable in the event log and
 * fully reconstructible from it, which under ADR-098's projection/process-manager
 * split reads as a projection, rebuilt by replay. Under that reading the
 * stale guard is a defect rather than a safeguard. It is kept because the
 * dispatch shape is kept; if the reclassification is ever taken up, this
 * guard is the first thing to go.
 *
 * **Assessed 2026-07-29; the process-manager mount stands, and the note above
 * overstates the case.** Three things have to be true before the projection
 * row applies, and none of them is today:
 *
 *  1. *A projection derives a ROW; this derives an EVENT.* The relay's output
 *     is `reportEvaluation`, a command that appends `lw.evaluation.reported` to
 *     `event_log` for a different aggregate. The projection conversions already
 *     done on this pipeline (`governanceKpisSync`, `governanceOcsfEventsSync`,
 *     `gatewayBudgetSync`) all write derived ClickHouse rows idempotent on a
 *     natural key, which is what makes "rebuilt by replay" mean rewriting the
 *     same row. A rebuild that appends to the event store instead re-enters
 *     every downstream of that aggregate.
 *  2. *"No billing to protect against replay" is not accurate.*
 *     `lw.evaluation.reported` IS metered — `orgBillableEventsMeter` subscribes
 *     to it and writes `billable_events`. It happens to be replay-safe, but
 *     because the row's `DeduplicationKey` is the command's idempotency key
 *     (`${tenantId}:${evaluationId}:reported`, derived from the deterministic
 *     evaluation id), NOT because there is no money on the path. The same is
 *     true of `evaluationAnalyticsRollup`, an additive sink kept honest by
 *     `dedupeByIdempotencyKey` — which is fail-open on event-log read lag.
 *     Any conversion has to re-argue both, not assume neither exists.
 *  3. *The outbox's retry is load-bearing, not incidental.* The intent handler
 *     deliberately THROWS when the claim-check read comes back empty, so the
 *     lease backs off and re-asks until the sibling span write lands
 *     (ADR-098). `MapProjectionOptions` has no lease, no per-message backoff
 *     and no `filter` — so the conversion would also lose
 *     `CUSTOM_EVALUATION_SYNC_ENQUEUE` and mint a projection job for every
 *     `span_received` in the product. This missing seam is the thing that
 *     must land BEFORE any further projection conversion on this pipeline.
 *
 * So the guard is not "a defect kept for shape". What was a real defect is that
 * it discarded a customer's verdict silently; that is fixed below. Deleting it
 * outright, and moving the process to a projection, remains an ADR decision
 * (it re-classifies a call site this pipeline enumerates, and edits the mount),
 * not a cleanup.
 */

const logger = createLogger(
  "langwatch:trace-processing:custom-evaluation-sync-process",
);

export type CustomEvaluationSyncIntents = {
  reportEvaluations: IntentSpec<typeof customEvaluationReportIntentSchema>;
};

type Ctx = ProcessHandlerContext<CustomEvaluationSyncIntents>;

/**
 * Whether this span carried a custom evaluation, without parsing one.
 *
 * A name match plus a string-valued payload attribute is the whole test — the
 * same cheap presence check its predecessor ran, for the same reason: this
 * decides whether a span costs an outbox row and a ClickHouse read, and it
 * runs against attacker-supplied span payloads.
 */
function spanCarriesEvaluations(data: Record<string, unknown>): boolean {
  const spanEvents = spanOf(data)?.events;
  if (!Array.isArray(spanEvents)) return false;

  return spanEvents.some((spanEvent) => {
    if (typeof spanEvent !== "object" || spanEvent === null) return false;
    const entry = spanEvent as { name?: unknown; attributes?: unknown };
    if (entry.name !== CUSTOM_EVALUATION_SPAN_EVENT_NAME) return false;
    return (
      readOtlpString(entry.attributes, CUSTOM_EVALUATION_PAYLOAD_ATTRIBUTE) !==
      null
    );
  });
}

/**
 * The enqueue-time gate (ADR-098): a span that carried no custom
 * evaluation never mints a job, an inbox row, or a process instance.
 *
 * This is the reactor's `hasSyncableEvaluations` predicate, restored to where
 * it ran before ADR-075 (now ADR-098) moved it inside the handler. It is the ONE guard in
 * this process that can legally move: a name match plus a string-valued
 * attribute over the raw wire span, with no JSON parse, no store read and no
 * feature flag — total, so the retry-less routing seam cannot lose a job to it.
 * Everything else this process decides (the store read, the payload parse, the
 * command sends) stays in the intent handler, where a throw re-leases.
 *
 * The stale-event half of the reactor's predicate deliberately does NOT come
 * along: `isStale` compares the event's instant against *handling* time, which
 * is not a property of the event and would make the seam's answer depend on how
 * backed up the queue was. It stays in the handler.
 *
 * The handler re-asks the same question (`view.hasCustomEvaluations`) rather
 * than trusting the filter: during a rolling deploy, jobs staged by a build
 * without the filter are still draining.
 */
export function spanCarriesCustomEvaluations(
  event: TraceProcessingEvent,
): boolean {
  return spanCarriesEvaluations((event.data ?? {}) as Record<string, unknown>);
}

/**
 * The enqueue-time gate, declared here rather than at the mount because what a
 * process may decline before a job exists is a property of the process.
 *
 * No dedup window: unlike its trace-keyed siblings, each span's verdicts are
 * distinct work identified by that span (ADR-098), so there is nothing to
 * collapse — which is exactly how the reactor keyed it, per event rather than
 * per trace. The filter is the whole win here, and it is a total one: a project
 * whose SDK reports no custom evaluations stages nothing at all.
 */
export const CUSTOM_EVALUATION_SYNC_ENQUEUE: ProcessManagerEnqueueOptions<TraceProcessingEvent> =
  { filter: spanCarriesCustomEvaluations };

/**
 * The content boundary (`toPayload`): narrows a committed span event to the
 * span's identity and whether it is worth reading back. The span itself — its
 * prompts, its completions, its tool output, and the evaluation payloads —
 * stops here.
 *
 * The identity is built by `makeSpanReferencedEvent`, the pipeline's canonical
 * span-reference field-pick, rather than re-derived: it is already total, it
 * already refuses the two shapes a windowed store read cannot resolve, and its
 * `startTimeUnixNano` parse handles the protobuf `Long` that a hand-rolled
 * string/number read silently gets wrong.
 *
 * Total: an unreadable span degrades to "no evaluations", which is the same
 * answer an ordinary span gives. A throw here is a delivery failure on an
 * event the process cannot skip, which would park the trace's group.
 */
export function buildProcessEventView(
  event: TraceProcessingEvent,
): CustomEvaluationSyncEventView {
  const data = (event.data ?? {}) as Record<string, unknown>;
  const hasCustomEvaluations = spanCarriesEvaluations(data);

  const reference = parseSpanReferencedEvent(
    makeSpanReferencedEvent(event as SpanReceivedEvent),
  );

  return {
    spanId: reference?.data.spanId ?? null,
    spanStartedAt: reference?.data.startTimeUnixMs ?? null,
    hasCustomEvaluations,
  };
}

/**
 * A resync or backfill flood, not a live trace. Replay and resync paths
 * re-emit events with historical `occurredAt`; the test is the gap between
 * when the event happened and when it is being handled.
 *
 * `ctx.at` is the span's BUSINESS time, so this catches more than a flood: a
 * live SDK that batch-exports after a long job, a client whose clock runs
 * behind, and a trace-processing group parked past the threshold all answer
 * true while holding a verdict the customer genuinely computed. That is why
 * the caller counts and logs the branch — see the classification note in this
 * file's docblock, and `langwatch_custom_evaluation_sync_dropped_total`.
 *
 * This guard is also what makes the process non-reproducing under replay,
 * which is correct for dispatched work and wrong for derived state.
 */
function isStale(ctx: Ctx): boolean {
  return ctx.now - ctx.at > STALE_TRACE_THRESHOLD_MS;
}

/**
 * A span arrived on this trace. If it carried evaluations the SDK ran itself,
 * ask for them to be reported.
 *
 * Raised as the span is handled rather than after a wait: the verdicts are
 * already final, and the outbox is what makes the ask survive. Nothing is
 * armed, so `nextWakeAt` is null on every path.
 */
export const handleSpanReceived: EventHandler<
  CustomEvaluationSyncState,
  unknown,
  CustomEvaluationSyncIntents
> = (state, payload, ctx) => {
  const view = customEvaluationSyncEventViewSchema.parse(payload);
  const idle: ProcessEvolution<CustomEvaluationSyncState> = {
    state,
    nextWakeAt: null,
  };

  if (!view.hasCustomEvaluations) return idle;

  // The span carried a verdict and this declines it, so the drop is reported
  // the same way the unreferenceable one below is. Nothing downstream will
  // ever show this evaluation and nothing upstream will ask again — the
  // customer simply sees an evaluation that never ran — and the guard fires on
  // more than the resync flood it was written for: an SDK that batch-exports
  // after a long job, a client whose clock runs behind, and a trace-processing
  // group parked past the threshold all reach it with a live verdict in hand.
  // Which of those is happening is only answerable from the age, so the age is
  // in the line. See the classification note in this file's docblock: this
  // makes the cost of the guard auditable, it does not change it.
  if (isStale(ctx)) {
    customEvaluationSyncDroppedCounter.inc({ reason: "stale" });
    logger.warn(
      {
        tenantId: ctx.projectId,
        traceId: ctx.key,
        spanId: view.spanId,
        ageMs: ctx.now - ctx.at,
      },
      "Dropping custom evaluations — the span is older than the stale-trace threshold",
    );
    return idle;
  }

  // An evaluation addressed at nothing cannot be attributed to a trace, and a
  // report with no project cannot be addressed at a tenant at all.
  if (!ctx.key || !ctx.projectId) return idle;

  // The span carried verdicts but cannot be referenced, so there is nothing to
  // read them back from. `makeSpanReferencedEvent`'s own docblock records this
  // as a shape only a future producer could send; logged at error because if
  // it ever does happen, a customer's evaluation was dropped.
  if (view.spanId === null || view.spanStartedAt === null) {
    customEvaluationSyncDroppedCounter.inc({ reason: "unreferenceable" });
    logger.error(
      { tenantId: ctx.projectId, traceId: ctx.key },
      "Dropping custom evaluations — the span cannot be referenced for read-back",
    );
    return idle;
  }

  return {
    state,
    nextWakeAt: null,
    intents: [
      ctx.intents.reportEvaluations(
        reportEvaluationsMessageKey(ctx.key, view.spanId),
        {
          tenantId: ctx.projectId,
          traceId: ctx.key,
          spanId: view.spanId,
          occurredAt: ctx.at,
          spanStartedAt: view.spanStartedAt,
        },
      ),
    ],
  };
};

/**
 * The `customEvaluationSync` process-manager topology, exported standalone so
 * the pipeline mounts one expression of it and tests can build the exact
 * definition the runtime runs. `trace-processing/pipeline.ts` mounts it as
 * `.withProcessManager(CUSTOM_EVALUATION_SYNC_PROCESS_NAME,
 * customEvaluationSyncPM(deps.customEvaluationSyncDispatch))`.
 *
 * Evaluations an SDK ran itself arrive stapled to a span. The intent carries
 * the span's identity alone and reads the verdicts back out of the span store
 * (ADR-098's claim-check), so the retries are sized for losing the race against
 * the sibling span write rather than for a failing command.
 */
export function customEvaluationSyncPM(
  dispatch: CustomEvaluationSyncDispatchDeps,
): ProcessManagerApplier<TraceProcessingEvent> {
  return (pm) =>
    pm
      .state(INITIAL_CUSTOM_EVALUATION_SYNC_STATE)
      .intent(
        CUSTOM_EVALUATION_SYNC_INTENT_TYPES.REPORT_EVALUATIONS,
        customEvaluationReportIntentSchema,
        createCustomEvaluationReportHandler(dispatch),
      )
      .on(SPAN_RECEIVED_EVENT_TYPE, handleSpanReceived)
      .toPayload(buildProcessEventView)
      .enqueue(CUSTOM_EVALUATION_SYNC_ENQUEUE)
      .outbox({
        maxAttempts: CUSTOM_EVALUATION_SYNC_MAX_ATTEMPTS,
        leaseDurationMs: CUSTOM_EVALUATION_SYNC_LEASE_DURATION_MS,
        retryDelayMs: customEvaluationSyncRetryDelayMs,
      });
}
