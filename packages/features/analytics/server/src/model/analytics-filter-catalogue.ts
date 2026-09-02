/**
 * Which filter fields are meaningless without a key, or without a subkey.
 *
 * Kept on the server side because it is what the `dataForFilter` procedure
 * refuses on: a picker asking for `metadata.value` without naming the metadata
 * key is asking a question with no answer, and the refusal has to happen before
 * the query is built. The rest of a filter's catalogue entry — its display
 * name, its URL key, whether the picker is single-select — is presentation and
 * lives with the browser surface that renders it.
 *
 * Both sets are exhaustive over {@link FilterField} by construction: they are
 * `FilterField[]`, so a field removed from the enum stops compiling here.
 */
import type { FilterField } from "@langwatch/analytics-contract";

const FIELDS_REQUIRING_KEY: readonly FilterField[] = [
  "metadata.value",
  "evaluations.passed",
  "evaluations.score",
  "evaluations.label",
  "evaluations.state",
  "events.metrics.key",
  "events.metrics.value",
  "events.event_details.key",
];

const FIELDS_REQUIRING_SUBKEY: readonly FilterField[] = ["events.metrics.value"];

const requiringKey = new Set<string>(FIELDS_REQUIRING_KEY);
const requiringSubkey = new Set<string>(FIELDS_REQUIRING_SUBKEY);

/** Whether this field's options can only be read once a key is chosen. */
export const filterFieldRequiresKey = (field: FilterField): boolean =>
  requiringKey.has(field);

/** Whether this field's options can only be read once a subkey is chosen. */
export const filterFieldRequiresSubkey = (field: FilterField): boolean =>
  requiringSubkey.has(field);
