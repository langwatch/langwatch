import { retentionCategories } from "@langwatch/data-retention-contract";
import {
  INDEFINITE_EVENT_TYPE_PREFIXES,
  INDEFINITE_EVENT_TYPES,
  RETENTION_CLASS_BY_AGGREGATE_TYPE,
} from "@langwatch/data-retention-contract/event-log-retention-policy";

/** Which event-log rows each retention category owns, handed to eventing's retention (Q205). */
export const EVENT_LOG_RETENTION_CLASSIFICATION = {
  categories: retentionCategories,
  indefiniteClass: "indefinite",
  classByAggregateType: RETENTION_CLASS_BY_AGGREGATE_TYPE,
  indefiniteEventTypePrefixes: INDEFINITE_EVENT_TYPE_PREFIXES,
  indefiniteEventTypes: INDEFINITE_EVENT_TYPES,
} as const;
