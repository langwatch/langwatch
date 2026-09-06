import { HandledError } from "@langwatch/handled-error";

/**
 * The `account` queries better-auth issues, enumerated (ADR-116 §7).
 *
 * A storage-replacing branch cannot answer "any query at all" — it answers
 * the ones its caller actually asks. better-auth's internal adapter issues a
 * small, fixed set against `account`, and every one of them is named here —
 * fields, connectors AND operators. All three are part of a shape: a clause
 * recognized by its field alone answers a question nobody asked, and answering
 * `id ne X` as `id eq X` inverts a delete.
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

/**
 * The operators a field may carry, by field.
 *
 * Every shape below is an equality; `id` additionally arrives as an `in` list
 * when a user delete fans out. Validating the operator is load-bearing rather
 * than defensive: without it `where id ne X` matches the `byId` shape and is
 * answered as `byId(X)`, so a delete that meant "every row except X" removes
 * exactly the row it was told to spare.
 */
const OPERATORS_BY_FIELD: Record<string, readonly string[]> = { id: ["eq"] };
const EQUALITY_ONLY: readonly string[] = ["eq"];

const operatorIsEnumerated = (clause: AccountWhere): boolean =>
  (OPERATORS_BY_FIELD[clause.field] ?? EQUALITY_ONLY).includes(
    clause.operator?.toLowerCase() ?? "eq",
  );

/**
 * better-auth's `issuer`, inverted back to the `providerId` this branch keys
 * on — or null when it cannot be.
 *
 * 1.7 re-keyed an account from `(providerId, accountId)` to
 * `(issuer, accountId)`, and synthesises the issuer from the provider id for
 * every provider that declares none of its own: `local:<id>` for local
 * credentials, `local:oauth:<id>` for a social provider. `Identifier` stores
 * the provider id verbatim and no issuer at all, so a query that names only
 * the issuer is answerable exactly when the issuer is one of those two
 * synthetic forms.
 *
 * A provider that brings its OWN issuer — a real enterprise OIDC issuer URL —
 * is deliberately NOT derivable here, and must keep reaching the refusal
 * below. Guessing a provider id from an issuer we never minted is the silent
 * wrong answer this whole module exists to prevent: it would resolve one
 * IdP's subject onto another IdP's user.
 */
const OAUTH_ISSUER_PREFIX = "local:oauth:";
const LOCAL_ISSUER_PREFIX = "local:";

/**
 * The issuer better-auth 1.7 expects to see ON a row it is given back.
 *
 * `Identifier` stores no issuer — the provider id is its truth — so the
 * branch mints the synthetic one 1.7 would have minted itself. Without it a
 * credential row comes back failing 1.7's own `issuer = local:credential`
 * filter, which reads to the customer as a wrong password rather than as a
 * missing column.
 */
export const issuerForProviderId = (providerId: string): string =>
  providerId === "credential"
    ? `${LOCAL_ISSUER_PREFIX}${encodeURIComponent(providerId)}`
    : `${OAUTH_ISSUER_PREFIX}${encodeURIComponent(providerId)}`;

export const providerIdFromIssuer = (issuer: string): string | null => {
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

const only = (where: readonly AccountWhere[], ...fields: string[]): boolean =>
  where.length === fields.length &&
  fields.every((field) =>
    where.some(
      (clause) =>
        clause.field === field &&
        operatorIsEnumerated(clause) &&
        (clause.connector === undefined ||
          clause.connector.toUpperCase() === "AND"),
    ),
  );

/** The `id in [...]` shape, which is the one non-equality the branch serves. */
const onlyIdIn = (where: readonly AccountWhere[]): boolean => {
  const clause = where[0];
  return (
    where.length === 1 &&
    clause !== undefined &&
    clause.field === "id" &&
    clause.operator?.toLowerCase() === "in" &&
    Array.isArray(clause.value) &&
    (clause.connector === undefined ||
      clause.connector.toUpperCase() === "AND")
  );
};

const valueOf = (where: readonly AccountWhere[], field: string): unknown =>
  where.find((clause) => clause.field === field)?.value;

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
  // better-auth 1.7's account key. The issuer stands in for the provider id
  // it was minted from; a `providerId` clause beside it is the same fact said
  // twice, and is preferred verbatim when present rather than derived.
  if (only(where, "accountId", "issuer")) {
    const accountId = valueOf(where, "accountId");
    const issuer = valueOf(where, "issuer");
    if (typeof accountId === "string" && typeof issuer === "string") {
      const providerId = providerIdFromIssuer(issuer);
      if (providerId !== null) {
        return { kind: "byProviderSubject", providerId, accountId };
      }
    }
  }
  if (only(where, "accountId", "issuer", "providerId", "userId")) {
    const accountId = valueOf(where, "accountId");
    const providerId = valueOf(where, "providerId");
    const userId = valueOf(where, "userId");
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
  if (onlyIdIn(where)) {
    const ids = valueOf(where, "id") as unknown[];
    return {
      kind: "byIds",
      ids: ids.filter((value): value is string => typeof value === "string"),
    };
  }
  if (only(where, "id")) {
    const id = valueOf(where, "id");
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
