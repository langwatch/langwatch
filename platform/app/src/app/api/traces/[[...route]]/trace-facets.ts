/**
 * Which facet a caller may drill into, and under what name.
 *
 * The facet store answers three shapes of key — a registry key (`model`,
 * `status`), an attribute key under one of the namespace prefixes, and nothing
 * else — and it answers an unrecognised one by throwing a plain `Error`, which
 * over REST is a 500 for what is really a bad request. So the boundary decides
 * first.
 *
 * It also reconciles one spelling. The filter language, the autocomplete and
 * the query reference all call a trace-level attribute
 * `trace.attribute.<key>`; the facet store's own prefix for the same thing is
 * the older `attribute.<key>`. A caller reading the reference must be able to
 * paste the field name it just read, so the canonical form is accepted and
 * translated here rather than published twice.
 *
 * @see ../../../../server/app-layer/traces/facet-registry.ts — the keys
 * @see specs/traces/trace-filter-api.feature
 */

import { RequestValidationError } from "~/server/api/validation";
import { FACET_REGISTRY } from "~/server/app-layer/traces/facet-registry";
import {
  EVENT_ATTRIBUTE_PREFIX,
  SPAN_ATTRIBUTE_PREFIX,
  TRACE_ATTRIBUTE_PREFIX,
  TRACE_ATTRIBUTE_PREFIX_LEGACY,
} from "~/server/app-layer/traces/filter-to-clickhouse/value-helpers";

/** The body field a refusal points at. */
const FIELD_FIELD = "field";

/** Prefixes the facet store reads an attribute key out of, as it spells them. */
const STORE_ATTRIBUTE_PREFIXES: readonly string[] = [
  EVENT_ATTRIBUTE_PREFIX,
  SPAN_ATTRIBUTE_PREFIX,
  TRACE_ATTRIBUTE_PREFIX_LEGACY,
];

/**
 * Keys with values to list.
 *
 * A range facet is excluded: it has a minimum and a maximum, not a value set,
 * and the store refuses to drill into one. A caller asking for its values is
 * asking a question that has no answer, so the refusal says so up front rather
 * than after a round trip.
 */
const DRILLABLE_KEYS: readonly string[] = FACET_REGISTRY.filter(
  (definition) => definition.kind !== "range",
).map((definition) => definition.key);

/**
 * The key to hand the facet store, given what the caller wrote.
 *
 * @throws RequestValidationError 422 when the field has no values to list.
 */
export function resolveFacetKey(field: string): string {
  const trimmed = field.trim();
  const normalized = trimmed.startsWith(TRACE_ATTRIBUTE_PREFIX)
    ? `${TRACE_ATTRIBUTE_PREFIX_LEGACY}${trimmed.slice(TRACE_ATTRIBUTE_PREFIX.length)}`
    : trimmed;

  for (const prefix of STORE_ATTRIBUTE_PREFIXES) {
    if (!normalized.startsWith(prefix)) continue;
    if (normalized.length > prefix.length) return normalized;
    throw refuse({
      field: trimmed,
      message: `\`${prefix}\` needs an attribute key after it, for example \`${prefix}gen_ai.request.model\`.`,
    });
  }

  if (DRILLABLE_KEYS.includes(normalized)) return normalized;

  throw refuse({
    field: trimmed,
    message: `No facet named \`${trimmed}\` has values to list. Call this endpoint with no field to see which facets this project has, or GET /api/v1/query/reference for every filter field.`,
  });
}

function refuse({
  field,
  message,
}: {
  field: string;
  message: string;
}): RequestValidationError {
  return new RequestValidationError({
    target: "query",
    violations: [
      {
        field: FIELD_FIELD,
        type: "unknown_facet",
        message,
        expected: DRILLABLE_KEYS,
        received: field,
      },
    ],
  });
}
