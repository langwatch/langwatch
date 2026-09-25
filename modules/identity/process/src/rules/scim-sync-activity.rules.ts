import {
  SCIM_APPLY_FAILED_EVENT_TYPE,
  SCIM_APPLY_REDRIVEN_EVENT_TYPE,
  SCIM_APPLY_RETIRED_EVENT_TYPE,
  type ScimSyncActivityEntry,
  type ScimSyncEventType,
} from "@langwatch/identity-contract";

/** A retired or re-driven apply exists only because something went wrong: it reads as refused. */
const REFUSED_SCIM_SYNC_EVENT_TYPES: ReadonlySet<ScimSyncEventType> = new Set([
  SCIM_APPLY_FAILED_EVENT_TYPE,
  SCIM_APPLY_RETIRED_EVENT_TYPE,
  SCIM_APPLY_REDRIVEN_EVENT_TYPE,
]);

export function scimSyncActivityOutcome(type: ScimSyncEventType): ScimSyncActivityEntry["outcome"] {
  return REFUSED_SCIM_SYNC_EVENT_TYPES.has(type) ? "refused" : "ok";
}
