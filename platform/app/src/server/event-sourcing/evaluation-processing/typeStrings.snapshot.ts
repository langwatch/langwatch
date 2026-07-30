import type { TypeStringSnapshot } from "@langwatch/event-sourcing";

/**
 * Committed snapshot of every event type string the `evaluation` aggregate
 * has ever declared (ADR-105 §3). An event type string is written into the
 * event log forever, so `aggregate.unit.test.ts` compares the aggregate's
 * current `eventTypes` against this file via `checkTypeStringRatchet` on
 * every run: a disappearance — a rename or a removed event — would orphan
 * every already-stored row carrying the old string, and this is the diff a
 * reviewer is meant to read when that happens.
 *
 * Additions are free. Only a disappearance is a violation. Update this file
 * only by adding to it, never by rewriting an existing entry.
 */
export const EVALUATION_PROCESSING_TYPE_STRINGS: TypeStringSnapshot = {
  evaluation: ["evaluation/reported", "evaluation/started"],
};
