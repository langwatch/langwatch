import type { TypeStringSnapshot } from "@langwatch/event-sourcing";

/**
 * Every event type string the `evaluation` aggregate has declared. A string
 * that disappears orphans every stored row carrying it, so `aggregate.unit.test.ts`
 * ratchets the aggregate against this file. Additions are free; only add.
 */
export const EVALUATION_PROCESSING_TYPE_STRINGS: TypeStringSnapshot = {
  evaluation: ["lw.evaluation.reported", "lw.evaluation.started"],
};
