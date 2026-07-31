// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The reserved `langwatch.origin.*` / `langwatch.ingestion_source.*`
 * namespace, and the strip that keeps it receiver-authoritative.
 *
 * WHY A STRIP AND NOT JUST A STAMP
 * --------------------------------
 * Both governance streams (`governance_ocsf_events`, `governance_kpis`) gate
 * on `langwatch.origin.kind = "ingestion_source"` and take the row's
 * `source_id` from `langwatch.ingestion_source.id`. Those are the identity of
 * an AUDITOR-facing stream, so they must be facts the receiver established,
 * never values a payload asserted about itself.
 *
 * The IngestionSource receiver (`src/server/routes/ingest/ingestionRoutes.ts`)
 * gets that right by construction: it strips the reserved namespace and
 * re-stamps it from the authenticated `IngestionSource`. The GENERAL OTLP
 * route (`src/server/routes/otel.ts`) did not, so a project API key could
 * assert `langwatch.origin.kind` plus any `ingestion_source.id` it liked and
 * inject rows into an audit stream — same-tenant, but forged.
 *
 * Stripping on the general route (rather than validating the source id
 * downstream) is what makes the namespace's guarantee TRUE rather than
 * merely checked in one of its readers: after the strip, no caller-controlled
 * path can put these keys on a span at all, so every reader — the two
 * projections, the activity monitor's ClickHouse filters, the setup-state
 * service — inherits the guarantee without each having to re-derive it.
 *
 * WHY THIS IS SAFE FOR ORDINARY CUSTOMER TRAFFIC
 * ----------------------------------------------
 *  - `langwatch.` is the platform's own attribute namespace, and the pipeline
 *    already strips `langwatch.reserved.*` from customer spans on exactly this
 *    principle (`recordSpanCommand.ts`).
 *  - The prefixes carry a trailing dot, so `langwatch.origin` (the SDK /
 *    gateway provenance marker) and `langwatch.organization_id` are NOT
 *    matched. Only the dotted governance sub-namespace is removed.
 *  - Nothing in this repository or in the SDKs emits these keys except the
 *    receiver itself, and genuine governance traffic never traverses the
 *    general OTLP route — it is handed to the pipeline directly by
 *    `ingestionRoutes.ts` with the hidden Governance Project as tenant.
 *  - {@link stripReservedOriginAttrs} returns the SAME array when nothing
 *    matches, so the overwhelming majority of spans pay one scan and no
 *    allocation.
 *
 * Spec: specs/ai-gateway/governance/receiver-shapes.feature
 */

/**
 * Attribute-key prefixes only the receiver may set. Note the trailing dots:
 * `langwatch.origin` (without one) is a different, non-governance attribute
 * and is deliberately left alone.
 */
export const RESERVED_ORIGIN_PREFIXES = [
  "langwatch.origin.",
  "langwatch.ingestion_source.",
] as const;

/** Minimal structural view of an OTLP key/value — key is all this needs. */
interface KeyedAttribute {
  key?: string | null;
}

export function isReservedOriginKey(key: string | null | undefined): boolean {
  if (!key) return false;
  return RESERVED_ORIGIN_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/**
 * Drop every reserved-namespace attribute.
 *
 * Returns the input array unchanged when it holds none — the hot path for
 * customer traffic — so the common case costs a scan and nothing else.
 */
export function stripReservedOriginAttrs<T extends KeyedAttribute>(
  attributes: T[] | undefined | null,
): T[] | undefined | null {
  if (!attributes || attributes.length === 0) return attributes;
  if (!attributes.some((attribute) => isReservedOriginKey(attribute?.key))) {
    return attributes;
  }
  return attributes.filter((attribute) => !isReservedOriginKey(attribute?.key));
}

interface AttributeHolder {
  attributes?: KeyedAttribute[] | null;
}

interface TraceRequestShape {
  resourceSpans?:
    | ({
        resource?: AttributeHolder | null;
        scopeSpans?:
          | ({
              scope?: AttributeHolder | null;
              spans?: AttributeHolder[] | null;
            } | null)[]
          | null;
      } | null)[]
    | null;
}

interface LogRequestShape {
  resourceLogs?:
    | ({
        resource?: AttributeHolder | null;
        scopeLogs?:
          | ({
              scope?: AttributeHolder | null;
              logRecords?: AttributeHolder[] | null;
            } | null)[]
          | null;
      } | null)[]
    | null;
}

interface MetricRequestShape {
  resourceMetrics?: ({ resource?: AttributeHolder | null } | null)[] | null;
}

function stripHolder(holder: AttributeHolder | null | undefined): void {
  if (!holder) return;
  holder.attributes = stripReservedOriginAttrs(holder.attributes);
}

/**
 * Strip the reserved namespace off EVERY attribute holder of a parsed OTLP
 * trace request, in place: resource, instrumentation scope, and span.
 *
 * All three are caller-controlled, so all three are stripped. Resources
 * because the reserved keys are hoisted from a trace's whole attribute surface
 * downstream; instrumentation scopes for the same reason and one more — OTLP
 * gives `InstrumentationScope` its own writable `attributes` list, so a strip
 * that covered only resources and leaves would leave the namespace assertable
 * one level in, which moves the forgery rather than closing it. The guarantee
 * this module states is that NO caller-controlled path can put these keys into
 * a request; that is only true if the walk is exhaustive over the holders the
 * schema admits.
 */
export function stripReservedOriginAttrsFromTraceRequest(
  request: TraceRequestShape,
): void {
  for (const resourceSpans of request.resourceSpans ?? []) {
    if (!resourceSpans) continue;
    stripHolder(resourceSpans.resource);
    for (const scopeSpans of resourceSpans.scopeSpans ?? []) {
      stripHolder(scopeSpans?.scope);
      for (const span of scopeSpans?.spans ?? []) {
        stripHolder(span);
      }
    }
  }
}

/** Trace-request equivalent for OTLP logs (records + scopes + resources). */
export function stripReservedOriginAttrsFromLogRequest(
  request: LogRequestShape,
): void {
  for (const resourceLogs of request.resourceLogs ?? []) {
    if (!resourceLogs) continue;
    stripHolder(resourceLogs.resource);
    for (const scopeLogs of resourceLogs.scopeLogs ?? []) {
      stripHolder(scopeLogs?.scope);
      for (const record of scopeLogs?.logRecords ?? []) {
        stripHolder(record);
      }
    }
  }
}

/** Trace-request equivalent for OTLP metrics — resource attributes only. */
export function stripReservedOriginAttrsFromMetricRequest(
  request: MetricRequestShape,
): void {
  for (const resourceMetrics of request.resourceMetrics ?? []) {
    stripHolder(resourceMetrics?.resource);
  }
}
