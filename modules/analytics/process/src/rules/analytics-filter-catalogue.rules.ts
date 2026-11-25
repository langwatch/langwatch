/**
 * Which filter fields are meaningless without a key, or a subkey — kept
 * server-side because `dataForFilter` refuses on it before the query is
 * built. Both sets are `FilterField[]`, exhaustive over {@link FilterField}.
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

/** Whether this field's options can only be read once a key is chosen. */
export const filterFieldRequiresKey = (field: string): boolean =>
  FIELDS_REQUIRING_KEY.some((required) => required === field);

/** Whether this field's options can only be read once a subkey is chosen. */
export const filterFieldRequiresSubkey = (field: string): boolean =>
  FIELDS_REQUIRING_SUBKEY.some((required) => required === field);
