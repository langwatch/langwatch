import { HandledError } from "@langwatch/handled-error";

/**
 * The `account` queries better-auth issues, enumerated (ADR-116 §7).
 *
 * A storage-replacing branch cannot answer "any query at all" — it answers
 * the ones its caller actually asks. better-auth's internal adapter issues a
 * small, fixed set against `account`, and every one of them is named here.
 *
 * An unrecognized shape THROWS, and that is the load-bearing part: a missed
 * shape would be a silent wrong answer on the sign-in path, where `findOne`
 * returning null reads exactly like "no such account" — which is how a user
 * gets told their sign-in method does not exist. Failing loudly turns a
 * better-auth upgrade that adds a shape into a red test instead of a support
 * ticket. Scoped to `account` on purpose: it is the only model where per-record
 * routing has to be decidable, so no `user` query can raise it.
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
  /** findOAuthUser, findAccountByProviderId — the IdP callback's lookup. */
  | { kind: "byProviderSubject"; providerId: string; accountId: string }
  /** The row better-auth already holds an id for (token refresh, delete). */
  | { kind: "byId"; id: string }
  | { kind: "byIds"; ids: string[] }
  /** findAccounts, findAccountByUserId — the account list, and the
   *  `deleteMany` a user delete fans out from. */
  | { kind: "byUser"; userId: string }
  /** updatePassword — every credential account of one user. */
  | { kind: "byUserAndProvider"; userId: string; providerId: string };

/**
 * An `account` storage operation the identity branch does not serve.
 *
 * `fault: "platform"` because nothing the customer did caused it and nothing
 * they can do fixes it: the library asked for a shape we never taught the
 * branch. The model and the operator name the failure in the LOG, through
 * `reasons`, and never in the message — the message is customer-safe copy,
 * and the words a customer reads come from the presentation registry keyed
 * by `code`.
 */
export class IdentityUnsupportedStorageQueryError extends HandledError {
  constructor(detail: string) {
    super(
      "identity_unsupported_storage_query",
      "identity_unsupported_storage_query",
      {
        httpStatus: 500,
        fault: "platform",
        reasons: [new Error(detail)],
      },
    );
    this.name = "IdentityUnsupportedStorageQueryError";
  }
}

const shapeOf = (where: readonly AccountWhere[]): string =>
  where
    .map(
      (clause) =>
        `${clause.field}${clause.operator ? ` ${clause.operator}` : ""}`,
    )
    .sort()
    .join(", ") || "no predicate";

const only = (where: readonly AccountWhere[], ...fields: string[]): boolean =>
  where.length === fields.length &&
  fields.every((field) =>
    where.some(
      (clause) =>
        clause.field === field &&
        (clause.connector === undefined ||
          clause.connector.toUpperCase() === "AND"),
    ),
  );

const valueOf = (where: readonly AccountWhere[], field: string): unknown =>
  where.find((clause) => clause.field === field)?.value;

const operatorOf = (
  where: readonly AccountWhere[],
  field: string,
): string | undefined =>
  where.find((clause) => clause.field === field)?.operator?.toLowerCase();

/** Recognize one of the shapes above, or throw naming what arrived. */
export function parseAccountQuery({
  operation,
  where,
}: {
  operation: string;
  where: readonly AccountWhere[];
}): AccountQuery {
  if (only(where, "accountId", "providerId")) {
    const accountId = valueOf(where, "accountId");
    const providerId = valueOf(where, "providerId");
    if (typeof accountId === "string" && typeof providerId === "string") {
      return { kind: "byProviderSubject", providerId, accountId };
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
    const providerId = valueOf(where, "providerId");
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
