// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The governance gate, shared by both governance projections (ADR-075
 * Class C).
 *
 * Governance ingest is identified by attributes the RECEIVER stamps on
 * every span it accepts (`langwatch/src/server/routes/ingest/ingestionRoutes.ts`
 * → `stampOriginAttrs`), replacing any the payload supplied under a
 * reserved key. Those attributes are therefore present on the span
 * itself, not merely on the trace roll-up — which is what lets the two
 * governance streams be STATELESS map projections over `span_received`
 * rather than handlers hanging off the trace-summary fold.
 *
 * The gate below is only as trustworthy as that stamp, so the reserved
 * namespace has to be unwritable from OUTSIDE the receiver — otherwise a
 * project API key could assert `langwatch.origin.kind` and an arbitrary
 * `ingestion_source.id` and inject rows into an auditor-facing stream.
 * `@ee/governance/services/reservedOriginAttrs` owns that guarantee: the
 * receiver strips-then-stamps, and the general OTLP route
 * (`src/server/routes/otel.ts`) — the only other entry point that accepts
 * caller-chosen span attributes — strips without stamping. The REST
 * `/api/collector` path cannot reach the namespace at all: it builds span
 * attributes from a closed key set (`collectorSpan.utils.ts`).
 *
 * Two gates live here on purpose, and {@link normalizeGovernanceSpanOrNull}
 * is the two of them in the order every consumer needs:
 *
 *  - {@link isGovernanceOriginWireSpan} runs on the RAW OTLP span, before
 *    any normalisation, so a non-governance span (the overwhelming
 *    majority of platform traffic) costs one attribute-array scan and
 *    nothing else. Total by construction: it reads only `key` /
 *    `value.stringValue` off untrusted wire data and never throws.
 *  - {@link readGovernanceSpanFacts} runs on the NORMALIZED span and
 *    produces the identity every governance row is keyed by.
 *
 * Spec: specs/ai-gateway/governance/folds.feature
 * ADR:  dev/docs/adr/075-post-event-work-subscribers-and-process-managers.md
 */

import {
  GOVERNANCE_ATTR,
  GOVERNANCE_ORIGIN_KIND_VALUE,
} from "@ee/governance/services/governanceAttributeKeys";
import { spanNormalizationPipelineService } from "@ee/governance/services/spanDerivation.composition";
import { stringAttr } from "~/server/event-sourcing.old/pipelines/trace-processing/projections/services/trace-summary.utils";
import type { SpanReceivedEvent } from "~/server/event-sourcing.old/pipelines/trace-processing/schemas/events";
import type { NormalizedSpan } from "~/server/event-sourcing.old/pipelines/trace-processing/schemas/spans";

/** Fallback `SourceType` label when the receiver stamped no source type. */
export const GOVERNANCE_SOURCE_TYPE_UNKNOWN = "unknown";

/**
 * Cheap pre-normalisation gate on the raw OTLP span.
 *
 * Deliberately defensive: `data.span` is wire data behind a Zod-typed
 * cast, so an absent/!array `attributes`, a null entry, or a non-string
 * value all read as "not governance" instead of throwing. A throw here
 * would fail the map projection's job for an ordinary customer span.
 */
export function isGovernanceOriginWireSpan(span: unknown): boolean {
  if (typeof span !== "object" || span === null) return false;
  const attributes = (span as { attributes?: unknown }).attributes;
  if (!Array.isArray(attributes)) return false;

  for (const attribute of attributes) {
    if (typeof attribute !== "object" || attribute === null) continue;
    if ((attribute as { key?: unknown }).key !== GOVERNANCE_ATTR.ORIGIN_KIND) {
      continue;
    }
    const value = (attribute as { value?: { stringValue?: unknown } }).value;
    if (value?.stringValue === GOVERNANCE_ORIGIN_KIND_VALUE) return true;
  }
  return false;
}

/**
 * Gate on the raw wire span, then normalise — the one sequence both
 * governance map projections run before they can derive anything.
 *
 * It lives here rather than in each projection because the first half decides
 * whether a span is admitted to an AUDITOR-facing stream. A second copy of
 * that decision is a second thing to keep correct, and the failure mode of
 * letting them drift is a forged row in an audit stream, not a style
 * complaint. The second half is merely expensive, and the two belong together
 * anyway: normalising without the gate first is the cost this module exists
 * to avoid.
 *
 * Returns null when the span is not governance traffic, which is what a map
 * projection's `map` returns to say "nothing to store".
 */
export function normalizeGovernanceSpanOrNull(
  event: SpanReceivedEvent,
): NormalizedSpan | null {
  if (!isGovernanceOriginWireSpan(event.data.span)) return null;

  return spanNormalizationPipelineService.normalizeSpanReceived(
    event.tenantId,
    event.data.span,
    event.data.resource,
    event.data.instrumentationScope,
  );
}

/**
 * The identity a governance row is keyed by.
 *
 * `eventId` is the span id (hex) — the `event_id` folds.feature declares
 * for `governance_ocsf_events` and the value migration 00026's own
 * comment describes ("EventId is the span_id (hex) for span-shaped
 * traces"). It is immutable in the event log, so re-deriving the same
 * span always produces the same key, which is the whole reason these
 * streams can be rebuilt.
 */
export interface GovernanceSpanFacts {
  /** IngestionSource.id that produced the span. */
  sourceId: string;
  /** IngestionSource.sourceType label, or "unknown". */
  sourceType: string;
  /** Span id (hex) — the per-event idempotency key for both streams. */
  eventId: string;
  /** Trace the span belongs to; carried for correlation, not for keying. */
  traceId: string;
  /** The span's own business time (start), epoch ms. */
  eventTimeMs: number;
}

/**
 * Reads the governance identity off a normalized span, or null when the
 * span is not governance traffic / carries no usable identity.
 *
 * Returning null (rather than throwing or writing a partial row) is the
 * projection's skip signal: `MapProjectionExecutor` treats a null record
 * as "nothing to store".
 */
export function readGovernanceSpanFacts(
  span: NormalizedSpan,
): GovernanceSpanFacts | null {
  const attributes = span.spanAttributes;

  if (
    stringAttr(attributes, GOVERNANCE_ATTR.ORIGIN_KIND) !==
    GOVERNANCE_ORIGIN_KIND_VALUE
  ) {
    return null;
  }

  const sourceId = stringAttr(attributes, GOVERNANCE_ATTR.INGESTION_SOURCE_ID);
  if (!sourceId) return null;

  const eventId = span.spanId;
  if (!eventId) return null;

  const eventTimeMs = span.startTimeUnixMs;
  if (!Number.isFinite(eventTimeMs) || eventTimeMs <= 0) return null;

  return {
    sourceId,
    sourceType:
      stringAttr(attributes, GOVERNANCE_ATTR.INGESTION_SOURCE_TYPE) ??
      GOVERNANCE_SOURCE_TYPE_UNKNOWN,
    eventId,
    traceId: span.traceId,
    eventTimeMs,
  };
}
