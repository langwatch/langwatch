// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The governance gate, shared by both governance projections. Ingest is
 * identified by attributes the RECEIVER stamps on every span it accepts,
 * replacing any the payload supplied under a reserved key — so the gate reads
 * safely off the trace pipeline's own canonical span, already flat.
 */

import {
  GOVERNANCE_ATTR,
  GOVERNANCE_ORIGIN_KIND_VALUE,
} from "@ee/governance/services/governanceAttributeKeys";
import type { CanonicalSpan } from "~/server/event-sourcing/trace-processing/schema";

/** Fallback `SourceType` label when the receiver stamped no source type. */
export const GOVERNANCE_SOURCE_TYPE_UNKNOWN = "unknown";

/**
 * Cheap gate on the RAW OTLP wire span, before any normalisation — this is
 * what proves the receiver's attribute strip is enough to make the
 * governance gate reject a forged span (`reservedOriginAttrs.unit.test.ts`).
 * Deliberately defensive: wire data behind a Zod-typed cast, so a throw here
 * would fail a job for an ordinary customer span.
 */
function isOriginKindAttribute(attribute: unknown): boolean {
  if (typeof attribute !== "object" || attribute === null) return false;
  if ((attribute as { key?: unknown }).key !== GOVERNANCE_ATTR.ORIGIN_KIND) {
    return false;
  }
  const value = (attribute as { value?: { stringValue?: unknown } }).value;
  return value?.stringValue === GOVERNANCE_ORIGIN_KIND_VALUE;
}

export function isGovernanceOriginWireSpan(span: unknown): boolean {
  if (typeof span !== "object" || span === null) return false;
  const attributes = (span as { attributes?: unknown }).attributes;
  if (!Array.isArray(attributes)) return false;

  for (const attribute of attributes) {
    if (isOriginKindAttribute(attribute)) return true;
  }
  return false;
}

/** The identity a governance row is keyed by. */
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

function stringAttr(
  attrs: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const value = attrs[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Reads the governance identity off a canonical span, or null when the span
 * is not governance traffic / carries no usable identity. Null is the
 * projection's skip signal: nothing to store.
 */
export function readGovernanceSpanFacts(
  span: CanonicalSpan,
): GovernanceSpanFacts | null {
  if (
    stringAttr(span.attributes, GOVERNANCE_ATTR.ORIGIN_KIND) !==
    GOVERNANCE_ORIGIN_KIND_VALUE
  ) {
    return null;
  }

  const sourceId = stringAttr(
    span.attributes,
    GOVERNANCE_ATTR.INGESTION_SOURCE_ID,
  );
  if (!sourceId) return null;
  if (!span.spanId) return null;
  if (!Number.isFinite(span.startTimeUnixMs) || span.startTimeUnixMs <= 0) {
    return null;
  }

  return {
    sourceId,
    sourceType:
      stringAttr(span.attributes, GOVERNANCE_ATTR.INGESTION_SOURCE_TYPE) ??
      GOVERNANCE_SOURCE_TYPE_UNKNOWN,
    eventId: span.spanId,
    traceId: span.traceId,
    eventTimeMs: span.startTimeUnixMs,
  };
}
