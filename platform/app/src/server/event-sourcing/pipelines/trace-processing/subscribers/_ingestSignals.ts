import {
  readOtlpString,
  resourceOf,
  spanOf,
} from "../process-manager/otlpEventView";
import {
  ORIGIN_RESOLVED_EVENT_TYPE,
  SPAN_RECEIVED_EVENT_TYPE,
} from "../schemas/constants";
import {
  isOriginResolvedEvent,
  isSpanReceivedEvent,
  type TraceProcessingEvent,
} from "../schemas/events";

/**
 * The event types that carry a project's ingest signals, and so the ones the
 * project-level subscribers listen on.
 *
 * The same pair the rest of this pipeline already treats as "genuine new
 * message content" — `MESSAGE_EVENT_TYPES` in `traceOriginGuards.ts`, and the
 * `triggerMatch` / `graphTriggerActivity` subscribers in `pipeline.ts`. The
 * other trace-processing events (topic assignment, annotations, name changes,
 * metric correlations) are enrichment *on a trace that already ingested*, so a
 * project cannot reach them without having produced one of these first; and
 * none of them carries a span or a resource, so under an event-only subscriber
 * they could answer none of the questions below anyway.
 */
export const INGEST_SIGNAL_EVENT_TYPES = [
  SPAN_RECEIVED_EVENT_TYPE,
  ORIGIN_RESOLVED_EVENT_TYPE,
] as const;

/**
 * What a single ingest event says about the project that sent it.
 *
 * Reading these off one event is equivalent to reading them off the accumulated
 * `traceSummary` fold state the retired reactor used (ADR-075), and each for its
 * own reason:
 *
 * - `sdkLanguage` and `platform` are OTLP **resource** attributes, identical on
 *   every span a given exporter emits, so "whichever span won the debounce
 *   window" and "the merged trace attributes" cannot disagree.
 * - `origin` is only ever consulted for the one question below
 *   (`isSampleIngest`), and the seeder that produces sample traces stamps
 *   `langwatch.origin = "sample"` on **every** span it emits
 *   (`components/ops/foundry/traceExecutor.ts`), so a per-event read reaches the
 *   same verdict as the trace-level hoist.
 *
 * Nothing here reads a projection. A handler that read back the fold built from
 * the stream it is subscribed to would race it — there is no ordering guarantee
 * between a projection and a sibling subscriber.
 */
export interface IngestSignals {
  /** The origin this event itself states, or null when it states none. */
  origin: string | null;
  /** `telemetry.sdk.language` off the span's resource, or null. */
  sdkLanguage: string | null;
  /**
   * The resource-level `langwatch.platform` marker, or null.
   *
   * Resource-level deliberately: that is the only route by which the key ever
   * reached the trace attribute map the retired reactor read. Span attributes
   * are allowlisted by `TraceAttributeAccumulationService` (`SPAN_ATTR_MAPPINGS`
   * plus `metadata.*`), which has never included it, while non-standard
   * resource keys pass through verbatim.
   */
  platform: string | null;
}

const NO_SIGNALS: IngestSignals = {
  origin: null,
  sdkLanguage: null,
  platform: null,
};

/**
 * Reads a project's ingest signals off one committed event.
 *
 * **Three single-key reads, not a normalization.** These used to go through
 * `TraceRequestUtils.normalizeOtlpAttributes`, which flattens every attribute,
 * reconstructs flattened arrays and attempts a `JSON.parse` on every string
 * value — so answering three yes/no questions decoded the prompts and
 * completions the whole content boundary exists to keep out, twice per event
 * (span attributes and resource attributes), on the busiest stream in the
 * product. `readOtlpString` walks the raw `KeyValue[]` for one key and stops.
 *
 * The shortcut is only safe because none of the three can be rewritten by
 * normalization: they arrive as plain string values, and a flattened or
 * JSON-encoded encoding of any of them would produce a different key that the
 * old map read would have missed too. `sdkLanguage` and `platform` are resource
 * attributes, which the canonicalisation pass never sees; no extractor names
 * `langwatch.origin` or consumes a prefix covering it, so it survives into the
 * canonical map unchanged. **If an extractor ever claims `langwatch.origin`,
 * this has to normalize instead.**
 *
 * **Total**, which is what lets `isSampleIngestEvent` run as an `enqueue.filter`
 * on the retry-less routing seam (ADR-069): every read is shape-checked, and an
 * unrecognised shape reads as absent rather than throwing.
 */
export function readIngestSignals(event: TraceProcessingEvent): IngestSignals {
  if (isOriginResolvedEvent(event)) {
    // The deferred-origin path (`originGate`): a trace whose spans carried no
    // origin of their own gets one resolved for it later. The event states the
    // origin directly, and carries no resource, so it can answer nothing else.
    return { ...NO_SIGNALS, origin: readOriginResolvedOrigin(event) };
  }

  if (!isSpanReceivedEvent(event)) return NO_SIGNALS;

  const data = (event.data ?? {}) as Record<string, unknown>;
  const spanAttributes = spanOf(data)?.attributes;
  const resourceAttributes = resourceOf(data)?.attributes;

  return {
    // Span first, then resource — the precedence `TraceOriginService.hoistOrigin`
    // applies when it decides which explicit origin wins. The ingest-key
    // provenance stamp writes the resource form so an upstream payload cannot
    // forge a different origin per span.
    origin:
      readOtlpString(spanAttributes, "langwatch.origin") ??
      readOtlpString(resourceAttributes, "langwatch.origin"),
    sdkLanguage: readOtlpString(resourceAttributes, "telemetry.sdk.language"),
    platform: readOtlpString(resourceAttributes, "langwatch.platform"),
  };
}

/**
 * Whether this event is a seeded sample trace rather than a project actually
 * being used.
 *
 * Sample traces (the empty-state "Seed sample traces" path) must not count as
 * integration: treating them as such would dismiss the onboarding card while
 * the user has not connected their own app yet, and would schedule daily topic
 * clustering for every project that clicked the button once.
 *
 * Absence is not a sample — an event stating no origin is ordinary ingest,
 * which is the same reading the retired `isRealIngest` fold guard took.
 */
export function isSampleIngest(signals: IngestSignals): boolean {
  return signals.origin === "sample";
}

/**
 * The same question, asked of the raw event so it can be asked BEFORE a job
 * exists (ADR-069 invariant 4).
 *
 * This is the only honest event-only gate the project-level subscribers have.
 * The predicate their reactor used — "is this project still un-onboarded?" —
 * read fold state, and the fact it stood in for lives in a Prisma row that no
 * event carries; a subscriber that read the fold back would race the projection
 * it is a sibling of. So the onboarding latch stays in the handler and only the
 * sample check moves, which at least stops a seeded project paying jobs
 * forever.
 *
 * Total by construction — see `readIngestSignals`.
 */
export function isSampleIngestEvent(event: TraceProcessingEvent): boolean {
  return isSampleIngest(readIngestSignals(event));
}

/**
 * The queue group the project-level subscribers run their jobs in.
 *
 * **Load-bearing, not cosmetic.** Both subscribers deduplicate per PROJECT, and
 * the GroupQueue can only collapse a duplicate that is staged in the same
 * group. With the default per-aggregate group — one per trace — a project
 * ingesting two traces at once had its dedup key deleted and re-staged by
 * whichever trace moved next, so the "one round trip per project per window"
 * the window is written for was never what happened: the jobs came out roughly
 * per span. Keyed per project, the whole window really does collapse into one
 * job.
 *
 * The queue namespaces this under `subscriber/{name}` and the tenant already,
 * so the two subscribers still get a group each and one project's ingest can
 * never serialize behind another's.
 */
export const PROJECT_INGEST_GROUP_KEY = "project-ingest";

/** The origin an `origin_resolved` event states, read without trusting the cast. */
function readOriginResolvedOrigin(event: TraceProcessingEvent): string | null {
  const origin = ((event.data ?? {}) as { origin?: unknown }).origin;
  return typeof origin === "string" && origin.length > 0 ? origin : null;
}
