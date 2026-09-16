import { generate } from "@langwatch/ksuid";

/**
 * Directory-sync identity (D08); every sync command id form lives here.
 * There is no `newScimSyncId`: a connection has exactly one directory sync,
 * so the connection id IS the sync id (`scimSyncIdFor`).
 */

/**
 * One directory action's command id. Random, NOT derived — a nightly
 * re-push of the same state must not dedupe against the last one. What
 * makes a REPEATED push cost no event is the guard, not the command id.
 */
export function newScimSyncCommandId(): string {
  return generate("scimcmd").toString();
}
