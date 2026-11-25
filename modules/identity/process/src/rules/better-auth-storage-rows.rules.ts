import { HandledError } from "@langwatch/handled-error";
import { IdentityUnsupportedStorageQueryError } from "@langwatch/identity-contract";
import { fromDate, toDate } from "@langwatch/time";
import type { AdapterFactoryCustomizeAdapterCreator, CleanedWhere } from "better-auth/adapters";

import { type AccountWhere, issuerForProviderId } from "./better-auth-account-queries.rules.ts";
import type { IdentityAccountRow, IdentityAccountSecrets } from "./identity-storage.rules.ts";

/** A row as better-auth's adapter hands it over: field names to values. */
export type StorageRow = Record<string, unknown>;

/** The field and model naming better-auth's factory gives the adapter it customizes. */
export type AdapterNaming = Parameters<AdapterFactoryCustomizeAdapterCreator>[0];

/** A resolution or account miss: the normal "not on the identity branch" answer. */
const IDENTIFIER_NOT_FOUND = "identity_identifier_not_found";

/** The secret set the identity branch owns. Everything else on the `account`
 *  model is linkage, and linkage is a command rather than a column write. */
const SECRET_FIELDS = [
  "password",
  "accessToken",
  "refreshToken",
  "idToken",
  "accessTokenExpiresAt",
  "refreshTokenExpiresAt",
  "scope",
] as const;

/** Written by the store itself, so an update naming it is not a linkage
 *  rewrite and does not have to refuse. */
const UPDATE_PASSTHROUGH_FIELDS = ["createdAt", "updatedAt"] as const;

/**
 * Linkage columns better-auth RESTATES on an update it means as a secret write — accepted when
 * the value it carries already matches the row, and refused when it differs. A restatement is
 * not a rewrite.
 */
const LINKAGE_RESTATEMENT_FIELDS = ["providerId", "issuer", "accountId", "userId"] as const;

type LinkageRestatementField = (typeof LINKAGE_RESTATEMENT_FIELDS)[number];

const isLinkageRestatementField = (field: string): field is LinkageRestatementField =>
  LINKAGE_RESTATEMENT_FIELDS.some((known) => known === field);

/**
 * The value a row states for a linkage field, with `issuer` resolved the same way the served
 * row resolves it — a row attached before the fact carried an issuer answers with the synthetic
 * form better-auth minted, and that is the value better-auth is echoing back.
 */
const linkageValueOf = (row: IdentityAccountRow, field: LinkageRestatementField): string =>
  field === "issuer" ? (row.issuer ?? issuerForProviderId(row.providerId)) : row[field];

export function canonicalKeysOf({
  naming,
  model,
  data,
}: {
  naming: AdapterNaming;
  model: string;
  data: StorageRow;
}): StorageRow {
  return Object.fromEntries(
    Object.entries(data).map(([field, value]) => [
      naming.getDefaultFieldName({ model, field }),
      value,
    ]),
  );
}

export function storageKeysOf({
  naming,
  model,
  row,
}: {
  naming: AdapterNaming;
  model: string;
  row: StorageRow;
}): StorageRow {
  return Object.fromEntries(
    Object.entries(row).map(([field, value]) => [naming.getFieldName({ model, field }), value]),
  );
}

export function canonicalWhereOf({
  naming,
  model,
  where,
}: {
  naming: AdapterNaming;
  model: string;
  where: readonly CleanedWhere[] | undefined;
}): AccountWhere[] {
  return (where ?? []).map((clause) => ({
    ...clause,
    field: naming.getDefaultFieldName({ model, field: clause.field }),
  }));
}

/**
 * Whether an `account` write is scoped to one user and NOTHING else — every row they hold,
 * named by no provider, subject or row id. That shape reaches `deleteMany` from exactly one
 * place: better-auth erasing the user.
 */
export function isWholeUserScope(canonical: readonly AccountWhere[]): boolean {
  const clause = canonical[0];
  return (
    canonical.length === 1 &&
    clause !== undefined &&
    clause.field === "userId" &&
    (clause.operator === undefined || clause.operator.toLowerCase() === "eq") &&
    typeof clause.value === "string"
  );
}

export function secretsOf(row: StorageRow): IdentityAccountSecrets {
  return Object.fromEntries(
    SECRET_FIELDS.filter((field) => field in row).map((field) => [
      field,
      toSecretValue(row[field]),
    ]),
  );
}

/** The fields of an `account` update that are neither a secret, a store-written stamp, nor a
 *  linkage value every named row already states (an echo of what better-auth just read). */
export function foreignUpdateFields({
  update,
  rows,
}: {
  update: StorageRow;
  rows: readonly IdentityAccountRow[];
}): string[] {
  const restatesItself = (field: string): boolean =>
    isLinkageRestatementField(field) &&
    rows.length > 0 &&
    rows.every((row) => linkageValueOf(row, field) === update[field]);

  return Object.keys(update).filter(
    (field) =>
      !SECRET_FIELDS.some((secret) => secret === field) &&
      !UPDATE_PASSTHROUGH_FIELDS.some((passed) => passed === field) &&
      !restatesItself(field),
  );
}

/**
 * The row as better-auth 1.7 expects it, carrying the issuer half of its account key. The
 * identifier STORES the issuer — stated on the attach, exactly as better-auth decided it —
 * so the stored value is served verbatim.
 */
export function withIssuer(row: IdentityAccountRow): IdentityAccountRow {
  return { ...row, issuer: row.issuer ?? issuerForProviderId(row.providerId) };
}

/** better-auth's own value for a secret it wrote: an expiry arrives as a `Date`. */
function toSecretValue(value: unknown): unknown {
  return value instanceof Date ? fromDate(value) : (value ?? null);
}

/** An identity row as better-auth reads it: every moment back to the `Date` it expects. */
export function toBetterAuthAccount(row: IdentityAccountRow): StorageRow {
  return {
    ...row,
    accessTokenExpiresAt: row.accessTokenExpiresAt ? toDate(row.accessTokenExpiresAt) : null,
    refreshTokenExpiresAt: row.refreshTokenExpiresAt ? toDate(row.refreshTokenExpiresAt) : null,
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
  };
}

/** A read missing with `identity_identifier_not_found` is `missing`; other failures throw. */
export async function readIdentified<T>(
  read: Promise<T>,
): Promise<{ kind: "found"; value: T } | { kind: "missing" }> {
  try {
    return { kind: "found", value: await read };
  } catch (error) {
    if (HandledError.isHandled(error) && error.code === IDENTIFIER_NOT_FOUND) {
      return { kind: "missing" };
    }
    throw error;
  }
}

export function refuseOrderedAccountRead({
  sorted,
  offset,
}: {
  sorted: boolean;
  offset: number | undefined;
}): void {
  if (!sorted && (offset ?? 0) <= 0) return;
  throw new IdentityUnsupportedStorageQueryError(
    `identity storage adapter: better-auth issued an account findMany with ${sorted ? "a sort" : "an offset"}. ` +
      "The identity branch serves a user's sign-in methods unordered and unpaged; teach it the ordering the caller needs rather than guessing one.",
  );
}

/** better-auth's status vocabulary, from ours. Anything unmapped is a 500,
 *  which is the honest answer for a status the library cannot name. */
export function httpStatusFor(
  httpStatus: number,
):
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "GONE"
  | "UNPROCESSABLE_ENTITY"
  | "TOO_MANY_REQUESTS"
  | "SERVICE_UNAVAILABLE"
  | "INTERNAL_SERVER_ERROR" {
  switch (httpStatus) {
    case 400:
      return "BAD_REQUEST";
    case 401:
      return "UNAUTHORIZED";
    case 403:
      return "FORBIDDEN";
    case 404:
      return "NOT_FOUND";
    case 409:
      return "CONFLICT";
    case 410:
      return "GONE";
    case 422:
      return "UNPROCESSABLE_ENTITY";
    case 429:
      return "TOO_MANY_REQUESTS";
    case 503:
      return "SERVICE_UNAVAILABLE";
    default:
      return "INTERNAL_SERVER_ERROR";
  }
}
