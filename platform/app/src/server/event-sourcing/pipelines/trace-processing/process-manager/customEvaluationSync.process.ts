import { createLogger } from "@langwatch/observability";

import type {
  EventHandler,
  IntentSpec,
  ProcessEvolution,
  ProcessHandlerContext,
  ProcessManagerEnqueueOptions,
} from "~/server/event-sourcing/pipeline/processManagerDefinition";

import { STALE_TRACE_THRESHOLD_MS } from "../schemas/constants";
import {
  makeSpanReferencedEvent,
  parseSpanReferencedEvent,
  type SpanReceivedEvent,
  type TraceProcessingEvent,
} from "../schemas/events";
import {
  CUSTOM_EVALUATION_PAYLOAD_ATTRIBUTE,
  CUSTOM_EVALUATION_SPAN_EVENT_NAME,
  type CustomEvaluationSyncEventView,
  type CustomEvaluationSyncState,
  type customEvaluationReportIntentSchema,
  customEvaluationSyncEventViewSchema,
  reportEvaluationsMessageKey,
} from "./customEvaluationSyncProcess.types";
import { readOtlpString, spanOf } from "./otlpEventView";

/**
 * The `customEvaluationSync` process (ADR-075 Class D): pure state logic only.
 * The pipeline mounts these handlers; the runtime owns the manager, outbox and
 * wake workers.
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
 * extracts the evaluations there. That is ADR-069's claim-check, and it is
 * what lets the identity of the work be the SPAN (ADR-081: derived, never
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
 * is mounted as dispatched work (ADR-075 Class D). But what it actually does
 * is relay a fact that is already durable in the event log and fully
 * reconstructible from it, which by ADR-075's own decision table is the
 * "produces state someone later reads as fact → projection, rebuilt by
 * replay" row. Under that reading the stale guard is a defect rather than a
 * safeguard. It is kept because the dispatch shape is kept; if the
 * reclassification is ever taken up, this guard is the first thing to go.
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
 * The enqueue-time gate (ADR-069 invariant 4): a span that carried no custom
 * evaluation never mints a job, an inbox row, or a process instance.
 *
 * This is the reactor's `hasSyncableEvaluations` predicate, restored to where
 * it ran before ADR-075 moved it inside the handler. It is the ONE guard in
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
 * distinct work identified by that span (ADR-081), so there is nothing to
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
 * See the classification note in this file's docblock — this guard is what
 * makes the process non-reproducing under replay, which is correct for
 * dispatched work and wrong for derived state.
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
  if (isStale(ctx)) return idle;

  // An evaluation addressed at nothing cannot be attributed to a trace, and a
  // report with no project cannot be addressed at a tenant at all.
  if (!ctx.key || !ctx.projectId) return idle;

  // The span carried verdicts but cannot be referenced, so there is nothing to
  // read them back from. `makeSpanReferencedEvent`'s own docblock records this
  // as a shape only a future producer could send; logged at error because if
  // it ever does happen, a customer's evaluation was dropped.
  if (view.spanId === null || view.spanStartedAt === null) {
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
