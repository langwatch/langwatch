/**
 * What each analytics filter field is able to filter by, and the refusal for
 * anything else.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * A filter the platform cannot apply used to widen instead of failing. The
 * boolean fields translate their values by looking for the strings "true" and
 * "false" and fall back to "no filtering" when they find neither, so
 * `{"traces.error": ["Traces with error"]}` returned the same numbers as
 * `{}` and the same numbers as `["Traces without error"]`. Nothing in the
 * response said a filter had been dropped.
 *
 * That value is not invented: the filter-options endpoint returns each option
 * as a `field` (what to send) and a `label` (what to show), and "Traces with
 * error" is the label of the option whose field is "true". The UI sends the
 * field, so the UI never hit this. Anyone writing against the REST API by
 * reading the option list did.
 *
 * The same shape of silence exists for the two fields whose translation needs
 * a key: without one they match every row rather than saying the key is
 * missing.
 *
 * Refusing is the point. A 422 naming the field and listing what it accepts
 * costs one retry; numbers that look filtered and are not cost whatever gets
 * decided on them.
 */

import type { FieldViolation } from "~/server/api/validation";
import { RequestValidationError } from "~/server/api/validation";
import { availableFilters } from "./registry";
import type { FilterField } from "./types";

/** The only two values a boolean filter's options endpoint ever returns. */
const BOOLEAN_FILTER_VALUES = ["true", "false"] as const;

/**
 * Fields whose option list is exactly {true, false}.
 *
 * Kept as an explicit set rather than derived: the shared truth is the SQL in
 * `clickhouse/filter-definitions.ts`, which projects a boolean column to those
 * two strings, and there is no runtime handle on that.
 */
const BOOLEAN_VALUE_FIELDS = new Set<FilterField>([
  "traces.error",
  "annotations.hasAnnotation",
  "evaluations.passed",
]);

/**
 * Fields whose translation covers every row when the key is absent.
 *
 * Not every field carrying `requiresKey` belongs here. `evaluations.passed`,
 * `.score`, `.label` and `.state` all translate without one, filtering across
 * every evaluator instead of a named one: broader than the caller may have
 * meant, but honestly narrower than no filter, so it stays allowed.
 */
const FIELDS_REQUIRING_KEY = new Set<FilterField>(["metadata.value"]);

/** Fields whose translation covers every row when the subkey is absent. */
const FIELDS_REQUIRING_SUBKEY = new Set<FilterField>(["events.metrics.value"]);

/** How a field reads in a sentence written for a customer. */
function nameOf(field: FilterField): string {
  return availableFilters[field].name;
}

/** The name of the filter supplying `field`'s key, as the customer sees it. */
function keyNameOf(field: FilterField): string | undefined {
  const required =
    availableFilters[field].requiresSubkey ??
    availableFilters[field].requiresKey;
  return required ? nameOf(required.filter) : undefined;
}

function unsupportedValue(
  field: FilterField,
  received: string,
): FieldViolation {
  return {
    field: `filters.${field}`,
    type: "unsupported_filter_value",
    message: `The "${nameOf(field)}" filter accepts only "true" or "false". Send an option's value, not the label shown next to it.`,
    expected: [...BOOLEAN_FILTER_VALUES],
    received,
  };
}

function missingKey(field: FilterField): FieldViolation {
  const keyName = keyNameOf(field);
  return {
    field: `filters.${field}`,
    type: "missing_filter_key",
    message: keyName
      ? `The "${nameOf(field)}" filter needs a "${keyName}" to filter by, given as the object key next to the values.`
      : `The "${nameOf(field)}" filter needs a key to filter by, given as the object key next to the values.`,
  };
}

/** The first thing wrong with one field's filter, if anything is. */
function violationOf(args: {
  field: FilterField;
  values: string[];
  key?: string;
  subkey?: string;
}): FieldViolation | undefined {
  const { field, values, key, subkey } = args;

  if (BOOLEAN_VALUE_FIELDS.has(field)) {
    const bad = values.find(
      (value) => !(BOOLEAN_FILTER_VALUES as readonly string[]).includes(value),
    );
    if (bad !== undefined) return unsupportedValue(field, bad);
  }

  if (FIELDS_REQUIRING_KEY.has(field) && !key) return missingKey(field);
  if (FIELDS_REQUIRING_SUBKEY.has(field) && !subkey) return missingKey(field);

  return undefined;
}

/**
 * Refuse a filter this platform would otherwise drop.
 *
 * Called for every field of every analytics filter set, before any SQL is
 * built, so REST and tRPC callers get the identical refusal.
 */
export function assertFilterValuesAreSupported(args: {
  field: FilterField;
  values: string[];
  key?: string;
  subkey?: string;
}): void {
  const violation = violationOf(args);
  if (!violation) return;

  throw new RequestValidationError({
    target: "json",
    violations: [violation],
  });
}

/** One filter field's values, in any of the three shapes a filter set allows. */
type FilterValue =
  | string[]
  | Record<string, string[]>
  | Record<string, Record<string, string[]>>;

/**
 * Refuse an entire filter set, before anything decides how to serve it.
 *
 * Analytics has more than one query builder, and each one translates the
 * handful of fields its table can serve. Validating inside any single builder
 * would leave the others free to keep dropping values, so the whole set is
 * checked once at the service boundary instead. Walks the same nesting the
 * builders walk: a flat array, an object keyed by the filter's key, or one
 * keyed by key then subkey.
 */
export function assertFiltersAreSupported(
  filters: Partial<Record<FilterField, FilterValue>> | undefined,
): void {
  if (!filters) return;

  for (const [rawField, value] of Object.entries(filters)) {
    assertOneFieldIsSupported({ field: rawField as FilterField, value });
  }
}

/** One field's value, at whichever nesting depth it was found. */
function assertOneFieldIsSupported(args: {
  field: FilterField;
  value: unknown;
  key?: string;
  subkey?: string;
}): void {
  const { field, value, key, subkey } = args;
  if (!value || typeof value !== "object") return;

  if (Array.isArray(value)) {
    if (value.length === 0) return;
    assertFilterValuesAreSupported({ field, values: value, key, subkey });
    return;
  }

  for (const [nestedKey, nested] of Object.entries(value)) {
    assertOneFieldIsSupported({
      field,
      value: nested,
      key: key ?? nestedKey,
      subkey: key ? nestedKey : undefined,
    });
  }
}
