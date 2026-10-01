import { IdentityUnsupportedStorageQueryError } from "@langwatch/identity-contract";

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
  | { kind: "byUserAndProvider"; userId: string; providerId: string }
  /**
   * The SAME callback lookup as `byProviderSubject`, for a provider whose issuer is its own
   * rather than one we minted: better-auth keys these on the issuer the provider asserts, so
   * (issuer, providerAccountId) is a key this branch can answer on, with an index already there.
   */
  | { kind: "byIssuerSubject"; issuer: string; accountId: string };

const shapeOf = (where: readonly AccountWhere[]): string =>
  where
    .map((clause) => `${clause.field}${clause.operator ? ` ${clause.operator}` : ""}`)
    .toSorted()
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

const OAUTH_ISSUER_PREFIX = "local:oauth:";
const LOCAL_ISSUER_PREFIX = "local:";

/**
 * The issuer better-auth 1.7 expects to see ON a row it is given back. `Identifier` stores no
 * issuer — the provider id is its truth — so the branch mints the synthetic one 1.7 would
 * have minted itself.
 */
export const issuerForProviderId = (providerId: string): string =>
  providerId === "credential"
    ? `${LOCAL_ISSUER_PREFIX}${encodeURIComponent(providerId)}`
    : `${OAUTH_ISSUER_PREFIX}${encodeURIComponent(providerId)}`;

/** An issuer this branch minted names its `providerId`; any other is the provider's own. */
export type IssuerProvider = { minted: true; providerId: string } | { minted: false };

/** better-auth's `issuer`, inverted back to the `providerId` this branch keys on. */
export const providerIdFromIssuer = (issuer: string): IssuerProvider => {
  for (const prefix of [OAUTH_ISSUER_PREFIX, LOCAL_ISSUER_PREFIX]) {
    if (issuer.startsWith(prefix)) {
      const encoded = issuer.slice(prefix.length);
      if (encoded.length === 0) return { minted: false };
      try {
        return { minted: true, providerId: decodeURIComponent(encoded) };
      } catch {
        return { minted: false };
      }
    }
  }
  return { minted: false };
};

const only = (where: readonly AccountWhere[], ...fields: string[]): boolean =>
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
const onlyIdIn = (where: readonly AccountWhere[]): boolean => {
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

const valueOf = (where: readonly AccountWhere[], field: string): unknown =>
  where.find((clause) => clause.field === field)?.value;

type AccountQueryShape = (where: readonly AccountWhere[]) => AccountQuery[];

const byProviderSubject: AccountQueryShape = (where) => {
  if (!only(where, "accountId", "providerId")) return [];
  const accountId = valueOf(where, "accountId");
  const providerId = valueOf(where, "providerId");
  if (typeof accountId !== "string" || typeof providerId !== "string") return [];
  return [{ kind: "byProviderSubject", providerId, accountId }];
};

// better-auth 1.7's account key. The issuer stands in for the provider id
// it was minted from; a `providerId` clause beside it is the same fact said
// twice, and is preferred verbatim when present rather than derived.
const byIssuerSubject: AccountQueryShape = (where) => {
  if (!only(where, "accountId", "issuer")) return [];
  const accountId = valueOf(where, "accountId");
  const issuer = valueOf(where, "issuer");
  if (typeof accountId !== "string" || typeof issuer !== "string") return [];
  const provider = providerIdFromIssuer(issuer);
  if (provider.minted) {
    return [{ kind: "byProviderSubject", providerId: provider.providerId, accountId }];
  }
  // A provider that asserts its own issuer: refusing it failed every Google, GitHub, GitLab and
  // Azure sign-in once ONE user was finalized, since the callback key names no user.
  return [{ kind: "byIssuerSubject", issuer, accountId }];
};

// `userId` is a refinement, not decoration: the pair is unique, but answering a query that
// named a user with another user's row is the cross-tenant miss this module refuses to make.
const byUserProviderSubject: AccountQueryShape = (where) => {
  if (!only(where, "accountId", "issuer", "providerId", "userId")) return [];
  const accountId = valueOf(where, "accountId");
  const providerId = valueOf(where, "providerId");
  const userId = valueOf(where, "userId");
  if (typeof accountId !== "string" || typeof providerId !== "string") return [];
  if (typeof userId !== "string") return [];
  return [{ kind: "byUserProviderSubject", userId, providerId, accountId }];
};

const byIds: AccountQueryShape = (where) => {
  if (!onlyIdIn(where)) return [];
  const ids = valueOf(where, "id") as unknown[];
  return [
    { kind: "byIds", ids: ids.filter((value): value is string => typeof value === "string") },
  ];
};

const byId: AccountQueryShape = (where) => {
  const id = valueOf(where, "id");
  return only(where, "id") && typeof id === "string" ? [{ kind: "byId", id }] : [];
};

const byUser: AccountQueryShape = (where) => {
  const userId = valueOf(where, "userId");
  return only(where, "userId") && typeof userId === "string" ? [{ kind: "byUser", userId }] : [];
};

const byUserAndProvider: AccountQueryShape = (where) => {
  if (!only(where, "userId", "providerId")) return [];
  const userId = valueOf(where, "userId");
  const providerId = valueOf(where, "providerId");
  if (typeof userId !== "string" || typeof providerId !== "string") return [];
  return [{ kind: "byUserAndProvider", userId, providerId }];
};

/** Tried in order; the first shape that recognises the query answers it. */
const ACCOUNT_QUERY_SHAPES: readonly AccountQueryShape[] = [
  byProviderSubject,
  byIssuerSubject,
  byUserProviderSubject,
  byIds,
  byId,
  byUser,
  byUserAndProvider,
];

/** Recognize one of the shapes above, or throw naming what arrived. */
export function parseAccountQuery({
  operation,
  where,
}: {
  operation: string;
  where: readonly AccountWhere[];
}): AccountQuery {
  const [query] = ACCOUNT_QUERY_SHAPES.flatMap((shape) => shape(where));
  if (query !== undefined) return query;
  throw new IdentityUnsupportedStorageQueryError(
    `identity storage adapter: better-auth issued an account ${operation} the identity branch cannot answer: (${shapeOf(where)}). ` +
      "Answering it wrongly would look like a missing sign-in method, so it refuses instead. " +
      "Add the shape to account-queries.ts (@langwatch/identity-process/better-auth) and teach the branch to serve it.",
  );
}
