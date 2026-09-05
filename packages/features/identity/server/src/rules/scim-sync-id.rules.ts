import { generate } from "@langwatch/ksuid";

/**
 * Directory-sync identity (D08) — the analogue of `sso-connection-id.ts` one
 * aggregate over. Every form a sync command id takes lives here, so the
 * string that decides whether two calls are the same command is never a
 * template literal three modules apart from the one it has to agree with.
 *
 * These strings are a persisted contract: changing one makes every prior
 * command a different command. Add a form; never edit one.
 *
 * There is no `newScimSyncId`: a connection has exactly one directory sync,
 * so the connection id IS the sync id (`scimSyncIdFor`, @langwatch/identity-contract).
 */

/**
 * One directory action's command id.
 *
 * Random, NOT derived — and that is the whole point. A directory
 * legitimately re-pushes the same state every night, and those pushes are
 * different facts about different moments; deriving the id from the person
 * would make the second night's push dedupe against the first's and the
 * history would stop at the day the sync was set up. What makes a REPEATED
 * push cost no event is the guard finding nothing new to state, not the
 * command id.
 */
export function newScimSyncCommandId(): string {
  return generate("scimcmd").toString();
}
