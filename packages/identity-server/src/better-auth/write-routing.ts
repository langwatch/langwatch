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

export type RoutingTable = Readonly<
  Record<string, Readonly<Record<WriteOperation, Route>>>
>;

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
 * leave them populated). `user.create` is domain for the userHashKey mint
 * (ADR-101 §4) — its attach ceremony is unreachable by construction (a
 * brand-new user has no migration row, so the gate answers false) and their
 * email identifier is adopted by the backfill instead.
 */
const DEFAULT_ROUTING: RoutingTable = {
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

/** An unclassified (model, operation) — deliberately noisy (ADR-101 §2). */
export class IdentityAdapterUnroutedWriteError extends Error {
  constructor(
    readonly model: string,
    readonly operation: WriteOperation,
  ) {
    super(
      `identity adapter: better-auth wrote to an unrouted (model, operation): ("${model}", "${operation}"). ` +
        "Classify it in the routing table (@langwatch/identity-server/better-auth write-routing.ts) as protocol or domain.",
    );
    this.name = "IdentityAdapterUnroutedWriteError";
  }
}

/**
 * Which writes are domain-significant. An object rather than a bare
 * function so the table is a value a test can substitute and enumerate:
 * the coverage test asserts the real deployment's model list against
 * better-auth's, and a routing experiment does not have to mutate a module
 * constant to run.
 */
export class WriteRouting {
  constructor(private readonly table: RoutingTable = DEFAULT_ROUTING) {}

  /** The route, or a loud throw on first use of an unclassified write. */
  routeOf({
    model,
    operation,
  }: {
    model: string;
    operation: WriteOperation;
  }): Route {
    const route = this.table[model]?.[operation];
    if (!route) throw new IdentityAdapterUnroutedWriteError(model, operation);
    return route;
  }

  /** Every model this routing classifies — the coverage test's subject. */
  models(): string[] {
    return Object.keys(this.table);
  }
}
