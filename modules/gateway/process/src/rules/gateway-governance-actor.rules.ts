import { SYSTEM_ACTORS } from "@langwatch/authorization";

/**
 * The machine principals gateway attributes a write to when no person made it: `svc_<id>` for a
 * legacy project key or an API key with no owner (gateway.app.ts), and every `SYSTEM_ACTORS`
 * entry, typed `system:<name>` (a Connect licence's managed key among them).
 */
const MACHINE_ACTOR_PREFIXES = ["svc_", "system:"] as const;
const SYSTEM_ACTOR_IDS: ReadonlySet<string> = new Set(Object.values(SYSTEM_ACTORS));

/**
 * The person behind a governance fact's actor, or null for a machine principal: the fact names a
 * person or no one, never a stand-in id a reader could take for a user.
 */
export function toPersonActorId(actorUserId: string): string | null {
  const isMachine =
    SYSTEM_ACTOR_IDS.has(actorUserId) ||
    MACHINE_ACTOR_PREFIXES.some((prefix) => actorUserId.startsWith(prefix));
  return isMachine ? null : actorUserId;
}
