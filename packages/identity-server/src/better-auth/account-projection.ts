import type { IdentifierFact } from "@langwatch/identity";
import type { AccountCredentialRow } from "../account-credentials.repository";

/**
 * The `account` row better-auth expects, assembled from the two tables that
 * replaced it (ADR-116): the identifier says WHO holds the method, the
 * credential row says what secrets it carries.
 *
 * Field names are better-auth's canonical ones, not the legacy column names —
 * the adapter sits above the factory's field mapping, so it speaks
 * `providerId` / `accountId` / `accessToken`, and `accountId` means the
 * PROVIDER's subject rather than a row id. The row id is `id`, and it is the
 * credential's, which is the old `Account.id` the identifier already points
 * at. Nothing downstream can tell it moved.
 */
export interface BetterAuthAccountRow {
  id: string;
  userId: string;
  providerId: string;
  accountId: string;
  type: string;
  accessToken: string | null;
  refreshToken: string | null;
  idToken: string | null;
  password: string | null;
  scope: string | null;
  tokenType: string | null;
  sessionState: string | null;
  expiresAt: Date | null;
  extExpiresIn: number | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * One identifier plus its credential row, as better-auth reads it.
 *
 * An identifier with no credential row still answers — it is a real sign-in
 * method the user holds, and hiding it because the secrets table has not
 * caught up would make a linked account vanish from their settings page.
 * The secrets are simply absent, which is what they are.
 */
export function toBetterAuthAccount({
  identifier,
  credential,
}: {
  identifier: IdentifierFact;
  credential: AccountCredentialRow | null;
}): BetterAuthAccountRow {
  return {
    // The identifier's `accountId` is the credential row's id, and it is
    // what better-auth already holds for this account.
    id: credential?.id ?? identifier.accountId ?? identifier.identifierId,
    userId: identifier.userId,
    providerId: identifier.provider,
    // better-auth's `accountId` is the PROVIDER's subject. Falling back to
    // the identifier's value keeps a credential account (whose subject is
    // the mailbox) answering the same string it always did.
    accountId: identifier.providerAccountId ?? identifier.value ?? "",
    type: credential?.type ?? "oauth",
    accessToken: credential?.accessToken ?? null,
    refreshToken: credential?.refreshToken ?? null,
    idToken: credential?.idToken ?? null,
    password: credential?.password ?? null,
    scope: credential?.scope ?? null,
    tokenType: credential?.tokenType ?? null,
    sessionState: credential?.sessionState ?? null,
    expiresAt:
      credential?.expiresAtMs == null ? null : new Date(credential.expiresAtMs),
    extExpiresIn: credential?.extExpiresIn ?? null,
    createdAt: new Date(credential?.createdAtMs ?? identifier.attachedAtMs),
    updatedAt: new Date(credential?.updatedAtMs ?? identifier.attachedAtMs),
  };
}

/** The credential patch a better-auth `update` payload implies. */
export function toCredentialPatch(
  update: Record<string, unknown>,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const copy = (from: string, to: string) => {
    if (from in update) patch[to] = update[from];
  };
  copy("accessToken", "accessToken");
  copy("refreshToken", "refreshToken");
  copy("idToken", "idToken");
  copy("password", "password");
  copy("scope", "scope");
  copy("tokenType", "tokenType");
  copy("sessionState", "sessionState");
  copy("type", "type");
  copy("extExpiresIn", "extExpiresIn");
  if ("expiresAt" in update) {
    const value = update.expiresAt;
    patch.expiresAtMs =
      value instanceof Date
        ? value.getTime()
        : typeof value === "number"
          ? value
          : null;
  }
  return patch;
}
