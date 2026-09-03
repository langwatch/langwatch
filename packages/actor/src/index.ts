/**
 * The actor vocabulary: one closed answer to "who caused this action",
 * minted at the boundary that authenticated it and carried to every durable
 * record. The shape follows mojo's actor model — one union, boundary-minted,
 * with platform-initiated work attributed to the code that did it — with the
 * typing this package already applies to scopes and principals: a
 * discriminated union, not a bag of parameters.
 *
 * Two layers, on purpose:
 *
 * - {@link Actor} is the rich, in-process identity. It can say things the
 *   stored record does not need every consumer to parse — which person an
 *   impersonator was acting as, which code path an internal action ran from.
 * - {@link LedgerActor} is the durable record stamped onto ledger facts. Its
 *   shape (`{ type: "user" | "system", id }`) is frozen by every event
 *   already written; {@link toLedgerActor} is the ONE place the rich actor
 *   serializes down to it. No call site builds a `"system:..."` or
 *   `"apikey:..."` string by hand.
 */

/**
 * Every system principal a write can be attributed to, named by the surface
 * that acts as nobody. Adding a caller means adding one entry here, not
 * inventing a fresh `"system:..."` string at the call site.
 */
export const SYSTEM_ACTORS = {
  managementApi: "system:management-api",
  organizationService: "system:organization-service",
  apiKeyService: "system:api-key-service",
  inviteService: "system:invite-service",
  migrationRunner: "system:migration-runner",
  personalWorkspace: "system:personal-workspace",
  readThroughMint: "system:read-through-mint",
  ssoAutoJoin: "system:sso-auto-join",
  scim: "system:scim",
  /** Policy-driven auto-approval of a join request. An approval a person
   *  made carries that person as a user actor instead. */
  joinRequests: "system:join-requests",
} as const satisfies Record<string, `system:${string}`>;

export type SystemActorName = keyof typeof SYSTEM_ACTORS;

/** Who caused an action, as the boundary that authenticated it knows them. */
export type Actor =
  | {
      type: "user";
      id: string;
      /** Set when a platform operator is acting as this user. */
      impersonatorId?: string;
    }
  | { type: "api_key"; id: string }
  | { type: "system"; name: SystemActorName }
  | {
      type: "internal";
      /**
       * The code path that decided to act — a module path or named seam,
       * stated by the call site. "The platform did it" is never anonymous:
       * an internal action is attributable to the line that took it.
       */
      codePath: string;
      /** The running deploy, when the caller has it. */
      revision?: string;
    };

/** Mint the actor for platform-initiated work, named by its code path. */
export function internalActor(codePath: string, options?: { revision?: string }): Actor {
  return { type: "internal", codePath, revision: options?.revision };
}

/**
 * Who a write is attributed to in the ledger — the durable record. The shape
 * is frozen by every event already written; extend {@link Actor} and
 * {@link toLedgerActor}, never this.
 */
export type LedgerActor = { type: "user" | "system"; id: string | null };

/** The one serialization seam from the rich actor to the durable record. */
export function toLedgerActor(actor: Actor): LedgerActor {
  switch (actor.type) {
    case "user":
      return { type: "user", id: actor.id };
    case "api_key":
      return { type: "system", id: `apikey:${actor.id}` };
    case "system":
      return { type: "system", id: SYSTEM_ACTORS[actor.name] };
    case "internal":
      return { type: "system", id: `internal:${actor.codePath}` };
  }
}

/**
 * A user id if the write is attributable to a person; an API key id if it
 * is attributable to a credential acting for nobody; otherwise `fallback`,
 * the system principal named for the surface making the write.
 *
 * The composition helper for boundaries that hold raw ids rather than a
 * minted {@link Actor}.
 */
export function ledgerActorFor({
  userId,
  apiKeyId,
  fallback,
}: {
  userId?: string | null;
  apiKeyId?: string | null;
  fallback: SystemActorName;
}): LedgerActor {
  if (userId) return toLedgerActor({ type: "user", id: userId });
  if (apiKeyId) return toLedgerActor({ type: "api_key", id: apiKeyId });
  return toLedgerActor({ type: "system", name: fallback });
}
