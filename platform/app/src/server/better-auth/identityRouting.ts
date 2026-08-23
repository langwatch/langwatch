import type { IdentifierProvider } from "~/server/event-sourcing/pipelines/identity/schemas/events";

export const WRITE_OPERATIONS = [
  "create",
  "update",
  "updateMany",
  "delete",
  "deleteMany",
  "consumeOne",
  "incrementOne",
] as const;

export type WriteOperation = (typeof WRITE_OPERATIONS)[number];

export type Route = "protocol" | "domain";

/**
 * The routing table — every better-auth model this deployment mounts, every
 * write operation, explicitly classified. Keys are better-auth's CANONICAL
 * model names (the facade sits above the factory's model/field mapping, so
 * it sees `user`, never `User`).
 *
 * `domain` today means exactly the D01 ceremonies: an account created inside
 * a sign-up/link ceremony is an identifier attach; an account deleted is a
 * detach; a user deleted is an erasure (the ceremony that wipes
 * `Identifier.value`/`identifierHash` — a protocol row delete alone would
 * leave them populated). `user.create` is domain for the userHashKey mint (ADR-101 §4) —
 * its attach ceremony is unreachable by construction (a brand-new user has
 * no migration row, so the gate answers false) and their email identifier is
 * adopted by the backfill instead.
 */
const ROUTING: Record<string, Record<WriteOperation, Route>> = {
  user: {
    create: "domain",
    update: "protocol",
    updateMany: "protocol",
    delete: "domain",
    deleteMany: "domain",
    consumeOne: "protocol",
    incrementOne: "protocol",
  },
  account: {
    create: "domain",
    update: "protocol",
    updateMany: "protocol",
    delete: "domain",
    deleteMany: "domain",
    consumeOne: "protocol",
    incrementOne: "protocol",
  },
  session: {
    create: "protocol",
    update: "protocol",
    updateMany: "protocol",
    delete: "protocol",
    deleteMany: "protocol",
    consumeOne: "protocol",
    incrementOne: "protocol",
  },
  verification: {
    create: "protocol",
    update: "protocol",
    updateMany: "protocol",
    delete: "protocol",
    deleteMany: "protocol",
    consumeOne: "protocol",
    incrementOne: "protocol",
  },
  // better-auth's rate limiter persists here when its storage is "database".
  // This deployment stores rate limits in secondary storage (Redis), so the
  // model is dormant — routed anyway so a configuration change cannot become
  // an unrouted write in the middle of a sign-in burst.
  ratelimit: {
    create: "protocol",
    update: "protocol",
    updateMany: "protocol",
    delete: "protocol",
    deleteMany: "protocol",
    consumeOne: "protocol",
    incrementOne: "protocol",
  },
};

export const ROUTED_MODELS = Object.keys(ROUTING);

/** An unclassified (model, operation) — deliberately noisy (ADR-101 §2). */
export class IdentityAdapterUnroutedWriteError extends Error {
  constructor(
    readonly model: string,
    readonly operation: WriteOperation,
  ) {
    super(
      `identity adapter: better-auth wrote to an unrouted (model, operation): ("${model}", "${operation}"). ` +
        "Classify it in the routing table (identityRouting.ts) as protocol or domain.",
    );
    this.name = "IdentityAdapterUnroutedWriteError";
  }
}

export function routeWrite(model: string, operation: WriteOperation): Route {
  const route = ROUTING[model]?.[operation];
  if (!route) throw new IdentityAdapterUnroutedWriteError(model, operation);
  return route;
}

/** better-auth providerIds → the identifier provider vocabulary (D01). */
export function identifierProviderFor(providerId: string): IdentifierProvider {
  switch (providerId) {
    case "credential":
      return "credential";
    case "google":
      return "google";
    case "github":
      return "github";
    case "gitlab":
      return "gitlab";
    case "microsoft":
    case "azure-ad":
      return "azure-ad";
    default:
      // Generic OAuth / enterprise IdPs (auth0, okta, custom OIDC) all
      // arrive through the oidc bucket until D04 gives them connections.
      return "oidc";
  }
}
