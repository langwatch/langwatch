/**
 * The `account` queries better-auth issues, enumerated (ADR-116 §3).
 *
 * A storage-replacing adapter cannot answer "any query at all" — it answers
 * the ones its caller actually asks. better-auth's internal adapter issues a
 * small, fixed set against `account`, and every one of them is named here.
 *
 * An unrecognised shape THROWS. That is the load-bearing part: for a routing
 * table a missed entry was an unclassified write, but here a missed shape
 * would be a silent wrong answer on the sign-in path — `findOne` returning
 * null reads exactly like "no such account", which is how a user gets told
 * their sign-in method does not exist. Failing loudly turns a better-auth
 * upgrade that adds a shape into a red test instead of a support ticket.
 */

/** better-auth's own `Where` clause, narrowed to what these shapes use. */
export interface AccountWhere {
  field: string;
  value?: unknown;
  operator?: string;
  connector?: string;
}

export type AccountQuery =
  /** findOAuthUser, findAccountByProviderId — the IdP callback's lookup. */
  | {
      kind: "byProviderAccount";
      provider: string;
      providerAccountId: string;
    }
  /** The row better-auth already holds an id for (token refresh, delete). */
  | { kind: "byId"; id: string }
  | { kind: "byIds"; ids: string[] }
  /** findAccounts, findAccountByUserId — the account list. */
  | { kind: "byUser"; userId: string }
  /** updatePassword — every credential account of one user. */
  | { kind: "byUserAndProvider"; userId: string; provider: string };

export class UnsupportedAccountQueryError extends Error {
  constructor(
    readonly operation: string,
    readonly where: AccountWhere[],
  ) {
    const shape = where
      .map(
        (clause) =>
          `${clause.field}${clause.operator ? ` ${clause.operator}` : ""}`,
      )
      .sort()
      .join(", ");
    super(
      `identity account adapter: better-auth issued an account ${operation} this adapter cannot answer: (${shape || "no predicate"}). ` +
        "Answering it wrongly would look like a missing sign-in method, so it refuses instead. " +
        "Add the shape to account-queries.ts (@langwatch/identity-server/better-auth) and teach the adapter to serve it.",
    );
    this.name = "UnsupportedAccountQueryError";
  }
}

const only = (where: AccountWhere[], ...fields: string[]): boolean =>
  where.length === fields.length &&
  fields.every((field) =>
    where.some(
      (clause) =>
        clause.field === field &&
        (clause.connector === undefined ||
          clause.connector.toUpperCase() === "AND"),
    ),
  );

const valueOf = (where: AccountWhere[], field: string): unknown =>
  where.find((clause) => clause.field === field)?.value;

const operatorOf = (where: AccountWhere[], field: string): string | undefined =>
  where.find((clause) => clause.field === field)?.operator?.toLowerCase();

/**
 * Recognise one of the shapes above, or throw naming what arrived.
 *
 * `accountId` is better-auth's name for the PROVIDER's subject, not for a row
 * id — the row id is `id`. Getting those two the wrong way round is the most
 * likely mistake here, so they are read explicitly rather than by shape.
 */
export function parseAccountQuery({
  operation,
  where,
}: {
  operation: string;
  where: AccountWhere[];
}): AccountQuery {
  if (only(where, "accountId", "providerId")) {
    const providerAccountId = valueOf(where, "accountId");
    const provider = valueOf(where, "providerId");
    if (typeof providerAccountId === "string" && typeof provider === "string") {
      return { kind: "byProviderAccount", provider, providerAccountId };
    }
  }
  if (only(where, "id")) {
    const id = valueOf(where, "id");
    if (operatorOf(where, "id") === "in" && Array.isArray(id)) {
      return {
        kind: "byIds",
        ids: id.filter((value): value is string => typeof value === "string"),
      };
    }
    if (typeof id === "string") return { kind: "byId", id };
  }
  if (only(where, "userId")) {
    const userId = valueOf(where, "userId");
    if (typeof userId === "string") return { kind: "byUser", userId };
  }
  if (only(where, "userId", "providerId")) {
    const userId = valueOf(where, "userId");
    const provider = valueOf(where, "providerId");
    if (typeof userId === "string" && typeof provider === "string") {
      return { kind: "byUserAndProvider", userId, provider };
    }
  }
  throw new UnsupportedAccountQueryError(operation, where);
}
