import { z } from "zod";

import type { Event } from "../../domain/types.ts";

/**
 * The first-hop lanes an appended event is staged onto. A lane that cannot be
 * staged is recorded in the process store's outbox and re-driven from the
 * event log, never logged and dropped (dev/docs/ARCHITECTURE.md §9).
 */
export const handoffLaneKindSchema = z.enum(["fold", "state", "map", "subscriber"]);
export type HandoffLaneKind = z.infer<typeof handoffLaneKindSchema>;

/** The pipeline's own router, or the global registry fed by every pipeline. */
export const handoffScopeSchema = z.enum(["pipeline", "global"]);
export type HandoffScope = z.infer<typeof handoffScopeSchema>;

/** One lane that could not be staged, with the events it missed. */
export interface FailedHandoff<E extends Event = Event> {
  kind: HandoffLaneKind;
  lane: string;
  events: readonly E[];
  error: Error;
}

/** One recorded hand-off row's payload; its intent type is the lane kind. */
export const handoffPayloadSchema = z.object({
  pipeline: z.string(),
  scope: handoffScopeSchema,
  lane: z.string(),
  eventId: z.string(),
  aggregateId: z.string(),
});
export type HandoffPayload = z.infer<typeof handoffPayloadSchema>;

/** The outbox process every pipeline's failed hand-offs are recorded under. */
export const HANDOFF_PROCESS_NAME = "eventing-handoff";

/** Deterministic, so a double write of the same failure converges on one row. */
export function handoffMessageKey({
  kind,
  payload,
}: {
  kind: HandoffLaneKind;
  payload: HandoffPayload;
}): string {
  return `${payload.pipeline}:${payload.scope}:${kind}:${payload.lane}:${payload.eventId}`;
}
