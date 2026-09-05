import { HandledError } from "@langwatch/handled-error";

/**
 * The `account` queries better-auth issues, enumerated (ADR-116 §7).
 */

/** better-auth's own `Where` clause, narrowed to what these shapes use.
 *  Field names are CANONICAL — the adapter maps them back before parsing. */
export interface AccountWhere {
  field: string;
  value?: unknown;
  operator?: string;
  connector?: string;
}

export type AccountQuery =
  /** findAccountByKey, findAccountOwnerByKey — the IdP callback's lookup.
   *  (Named `findAccountByProviderId` / `findOAuthUser` before 1.7.) */
  | { kind: "byProviderSubject"; providerId: string; accountId: string }
  /** The same lookup with the user already named, which 1.7 issues when it
   *  updates a user it has a row for. Served as the subject lookup, refined
   *  to the user that was asked about. */
  | {
      kind: "byUserProviderSubject";
      userId: string;
      providerId: string;
      accountId: string;
    }
  /** The row better-auth already holds an id for (token refresh, delete). */
  | { kind: "byId"; id: string }
  | { kind: "byIds"; ids: string[] }
  /** findAccounts, findAccountByUserId — the account list, and the
   *  `deleteMany` a user delete fans out from. */
  | { kind: "byUser"; userId: string }
  /** updatePassword — every credential account of one user. */
  | { kind: "byUserAndProvider"; userId: string; providerId: string };

/**
 * An `account` storage operation the identity branch does not serve. `fault: "platform"`
 * because nothing the customer did caused it and nothing they can do fixes it: the library
 * asked for a shape we never taught the branch.
 */
export class IdentityUnsupportedStorageQueryError extends HandledError {
  constructor(detail: string) {
    super("identity_unsupported_storage_query", "identity_unsupported_storage_query", {
      httpStatus: 500,
      fault: "platform",
      reasons: [new Error(detail)],
    });
    this.name = "IdentityUnsupportedStorageQueryError";
  }
}

const shapeOf = (where: readonly AccountWhere[]): string =>
  where
    .map((clause) => `${clause.field}${clause.operator ? ` ${clause.operator}` : ""}`)
    .sort()
    .join(", ") || "no predicate";

/**
 * The operators a field may carry, by field. Every shape below is an equality; `id`
 * additionally arrives as an `in` list when a user delete fans out.
 */
const OPERATORS_BY_FIELD: Record<string, readonly string[]> = { id: ["eq"] };
const EQUALITY_ONLY: readonly string[] = ["eq"];

const operatorIsEnumerated = (clause: AccountWhere): boolean =>
  (OPERATORS_BY_FIELD[clause.field] ?? EQUALITY_ONLY).includes(
    clause.operator?.toLowerCase() ?? "eq",
  );

/**
 * better-auth's `issuer`, inverted back to the `providerId` this branch keys on — or null when
 * it cannot be.
 */
const OAUTH_ISSUER_PREFIX = "local:oauth:";
const LOCAL_ISSUER_PREFIX = "local:";

/** The account queries better-auth issues, and the shapes this branch answers. */
export class BetterAuthAccountQueriesAdapter {
  static create(): BetterAuthAccountQueriesAdapter {
    return new BetterAuthAccountQueriesAdapter();
  }

  private constructor() {}

  /**
   * The issuer better-auth 1.7 expects to see ON a row it is given back. `Identifier` stores no
   * issuer — the provider id is its truth — so the branch mints the synthetic one 1.7 would
   * have minted itself.
   */
  static issuerForProviderId = (providerId: string): string =>
    providerId === "credential"
      ? `${LOCAL_ISSUER_PREFIX}${encodeURIComponent(providerId)}`
      : `${OAUTH_ISSUER_PREFIX}${encodeURIComponent(providerId)}`;

  static providerIdFromIssuer = (issuer: string): string | null => {
    for (const prefix of [OAUTH_ISSUER_PREFIX, LOCAL_ISSUER_PREFIX]) {
      if (issuer.startsWith(prefix)) {
        const encoded = issuer.slice(prefix.length);
        if (encoded.length === 0) return null;
        try {
          return decodeURIComponent(encoded);
        } catch {
          return null;
        }
      }
    }
    return null;
  };

  private static only = (where: readonly AccountWhere[], ...fields: string[]): boolean =>
    where.length === fields.length &&
    fields.every((field) =>
      where.some(
        (clause) =>
          clause.field === field &&
          operatorIsEnumerated(clause) &&
          (clause.connector === undefined || clause.connector.toUpperCase() === "AND"),
      ),
    );

  /** The `id in [...]` shape, which is the one non-equality the branch serves. */
  private static onlyIdIn = (where: readonly AccountWhere[]): boolean => {
    const clause = where[0];
    return (
      where.length === 1 &&
      clause !== undefined &&
      clause.field === "id" &&
      clause.operator?.toLowerCase() === "in" &&
      Array.isArray(clause.value) &&
      (clause.connector === undefined || clause.connector.toUpperCase() === "AND")
    );
  };

  private static valueOf = (where: readonly AccountWhere[], field: string): unknown =>
    where.find((clause) => clause.field === field)?.value;

  /** Recognize one of the shapes above, or throw naming what arrived. */
  static parseAccountQuery({
    operation,
    where,
  }: {
    operation: string;
    where: readonly AccountWhere[];
  }): AccountQuery {
    if (BetterAuthAccountQueriesAdapter.only(where, "accountId", "providerId")) {
      const accountId = BetterAuthAccountQueriesAdapter.valueOf(where, "accountId");
      const providerId = BetterAuthAccountQueriesAdapter.valueOf(where, "providerId");
      if (typeof accountId === "string" && typeof providerId === "string") {
        return { kind: "byProviderSubject", providerId, accountId };
      }
    }
    // better-auth 1.7's account key. The issuer stands in for the provider id
    // it was minted from; a `providerId` clause beside it is the same fact said
    // twice, and is preferred verbatim when present rather than derived.
    if (BetterAuthAccountQueriesAdapter.only(where, "accountId", "issuer")) {
      const accountId = BetterAuthAccountQueriesAdapter.valueOf(where, "accountId");
      const issuer = BetterAuthAccountQueriesAdapter.valueOf(where, "issuer");
      if (typeof accountId === "string" && typeof issuer === "string") {
        const providerId = BetterAuthAccountQueriesAdapter.providerIdFromIssuer(issuer);
        if (providerId !== null) {
          return { kind: "byProviderSubject", providerId, accountId };
        }
      }
    }
    if (
      BetterAuthAccountQueriesAdapter.only(where, "accountId", "issuer", "providerId", "userId")
    ) {
      const accountId = BetterAuthAccountQueriesAdapter.valueOf(where, "accountId");
      const providerId = BetterAuthAccountQueriesAdapter.valueOf(where, "providerId");
      const userId = BetterAuthAccountQueriesAdapter.valueOf(where, "userId");
      if (
        typeof accountId === "string" &&
        typeof providerId === "string" &&
        typeof userId === "string"
      ) {
        // `userId` is a refinement, not decoration: the pair below is unique,
        // but answering a query that named a user with another user's row is
        // the cross-tenant miss this module refuses to make.
        return { kind: "byUserProviderSubject", userId, providerId, accountId };
      }
    }
    if (BetterAuthAccountQueriesAdapter.onlyIdIn(where)) {
      const ids = BetterAuthAccountQueriesAdapter.valueOf(where, "id") as unknown[];
      return {
        kind: "byIds",
        ids: ids.filter((value): value is string => typeof value === "string"),
      };
    }
    if (BetterAuthAccountQueriesAdapter.only(where, "id")) {
      const id = BetterAuthAccountQueriesAdapter.valueOf(where, "id");
      if (typeof id === "string") return { kind: "byId", id };
    }
    if (BetterAuthAccountQueriesAdapter.only(where, "userId")) {
      const userId = BetterAuthAccountQueriesAdapter.valueOf(where, "userId");
      if (typeof userId === "string") return { kind: "byUser", userId };
    }
    if (BetterAuthAccountQueriesAdapter.only(where, "userId", "providerId")) {
      const userId = BetterAuthAccountQueriesAdapter.valueOf(where, "userId");
      const providerId = BetterAuthAccountQueriesAdapter.valueOf(where, "providerId");
      if (typeof userId === "string" && typeof providerId === "string") {
        return { kind: "byUserAndProvider", userId, providerId };
      }
    }
    throw new IdentityUnsupportedStorageQueryError(
      `identity storage adapter: better-auth issued an account ${operation} the identity branch cannot answer: (${shapeOf(where)}). ` +
        "Answering it wrongly would look like a missing sign-in method, so it refuses instead. " +
        "Add the shape to account-queries.ts (@langwatch/identity-server/better-auth) and teach the branch to serve it.",
    );
  }
}
