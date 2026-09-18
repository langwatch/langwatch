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

import { HandledError } from "@langwatch/handled-error";
import { RequestValidationError } from "~/server/api/validation";
import { FACET_REGISTRY } from "~/server/app-layer/traces/facet-registry";
import {
  EVENT_ATTRIBUTE_PREFIX,
  SPAN_ATTRIBUTE_PREFIX,
  TRACE_ATTRIBUTE_PREFIX,
  TRACE_ATTRIBUTE_PREFIX_LEGACY,
} from "~/server/app-layer/traces/filter-to-clickhouse/value-helpers";
import { redactHiddenAttributes } from "~/server/traces/mappers/redactAttributes";
import type { Protections } from "~/server/traces/protections";
import { canReadCapturedContent } from "~/server/traces/protections";

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
 * Refuses the values behind an arbitrary attribute key to a caller who cannot
 * read captured content.
 *
 * A registry facet is a known dimension: a model name, a status, an evaluator
 * id. An attribute key is whatever the instrumentation put there, and the
 * gen_ai conventions put prompts and completions in exactly these namespaces.
 * Listing their distinct values would hand back, one value at a time, what the
 * trace read path redacts. Attribute KEYS stay readable: a key names a
 * dimension, and the discovery payload is how a caller learns this project's
 * vocabulary for the filter language.
 */
export class TraceAttributeValuesWithheldError extends HandledError {
  declare readonly code: "trace_attribute_values_withheld";

  constructor(field: string) {
    super(
      "trace_attribute_values_withheld",
      "Attribute values are not listed to a caller who cannot read the content behind them",
      {
        httpStatus: 403,
        fault: "customer",
        meta: { field },
        tips: [
          "Two rules reach this: the project hides captured input or output from you, or an attribute policy restricts this key to an audience you are not in",
          "Facet a named field instead, for example `model`, `status` or `evaluator`",
          "GET /api/traces/facets with no field lists every facet this project has",
        ],
      },
    );
    this.name = "TraceAttributeValuesWithheldError";
  }
}

/**
 * Whether the caller may read the values behind one attribute key.
 *
 * Two rules, both already written elsewhere and asked here rather than
 * restated: the project must let this viewer read captured content at all, and
 * the key itself must not match a restrict rule whose audience excludes them.
 * The second is asked by handing the key to the read path's own redactor and
 * seeing whether it comes back replaced.
 */
function mayReadAttributeValues({
  key,
  protections,
}: {
  key: string;
  protections: Protections;
}): boolean {
  if (!canReadCapturedContent(protections)) return false;
  const probe = { [key]: "" };
  return redactHiddenAttributes(probe, protections.hiddenAttributes) === probe;
}

/**
 * Whether a resolved facet key names an arbitrary attribute rather than a
 * registry dimension.
 *
 * Asked after resolution, on the store's own spelling, so the canonical and
 * legacy prefixes are one case rather than two.
 */
export function isAttributeFacetKey(facetKey: string): boolean {
  return STORE_ATTRIBUTE_PREFIXES.some((prefix) => facetKey.startsWith(prefix));
}

/**
 * The key to hand the facet store, given what the caller wrote.
 *
 * @throws RequestValidationError 422 when the field has no values to list.
 * @throws TraceAttributeValuesWithheldError 403 when the field is an attribute
 * key and the project withholds captured content.
 */
export function resolveFacetKey({
  field,
  protections,
}: {
  field: string;
  protections: Protections;
}): string {
  const trimmed = field.trim();
  const normalized = trimmed.startsWith(TRACE_ATTRIBUTE_PREFIX)
    ? `${TRACE_ATTRIBUTE_PREFIX_LEGACY}${trimmed.slice(TRACE_ATTRIBUTE_PREFIX.length)}`
    : trimmed;

  for (const prefix of STORE_ATTRIBUTE_PREFIXES) {
    if (!normalized.startsWith(prefix)) continue;
    if (normalized.length > prefix.length) {
      if (
        !mayReadAttributeValues({
          key: normalized.slice(prefix.length),
          protections,
        })
      ) {
        throw new TraceAttributeValuesWithheldError(trimmed);
      }
      return normalized;
    }
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
