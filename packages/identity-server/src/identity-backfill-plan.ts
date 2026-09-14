import {
  arrivalStateForProvider,
  derivedAccountId,
  type ExpectedIdentifier,
  identifierProviderFor,
  normalizeIdentifierValue,
  upstreamOfAuth0Subject,
} from "@langwatch/identity";
import { nativeSocialIssuerFor } from "./better-auth/account-queries";
import { deriveIdentifierId } from "./crypto/identifier-identity";
import type {
  BackfillAccountRow,
  BackfillUserRow,
} from "./identity-backfill.repository";
import {
  adoptAccountCommandId,
  adoptDerivedAccountCommandId,
  adoptUserEmailCommandId,
} from "./identity-command-id";

/**
 * What the legacy rows IMPLY — the plan a backfill pass states, and the
 * same plan the parity check proves the projection against (ADR-101 §6).
 *
 * Its own module for the reason `offboard.ts` is its own module in authz:
 * this is a different shape of work from the service's steps. The service
 * sequences effects (adopt, establish, compensate, prove); this is a pure
 * function of two row sets, and keeping it here is what lets the parity
 * check and the adoption loop read the same plan rather than two
 * derivations that must be kept in agreement by hand.
 *
 * Every id in the plan is derived, none minted: the identifier ids come
 * from `deriveIdentifierId` over the row's own content, and the command
 * ids from `identity-command-id.ts`. That is what makes the pass restatable
 * — a second pass over unchanged rows produces a byte-identical plan.
 */

/** One identifier the legacy rows imply, with the command that adopts it. */
export type PlannedIdentifier = ExpectedIdentifier & {
  commandId: string;
  accountId: string | null;
  /** The legacy row's own `provider` string, unfolded — what better-auth
   *  queries `Account` by, and therefore what the fact has to carry. */
  providerId: string | null;
  /** The legacy row's own `issuer`, verbatim — the account key better-auth
   *  1.7 looks the row up by, adopted rather than re-derived so the fact and
   *  the row it was adopted from cannot disagree. */
  issuer: string | null;
  providerAccountId: string | null;
  occurredAtMs: number;
};

/**
 * The email identifier from `User.email` (VERIFIED when `emailVerified`),
 * plus one identifier per `Account` row in the state its provider arrives
 * in (R8) — and, for an Auth0-brokered row whose subject names a native
 * upstream, the native identifier that same row implies (D09, see
 * `derivedNativeIdentifier`). Business time is each row's own `createdAt`,
 * so live emission of the same fact derives the same identifier id.
 */
export function planIdentifiers({
  user,
  accounts,
}: {
  user: BackfillUserRow & { email: string };
  accounts: BackfillAccountRow[];
}): PlannedIdentifier[] {
  const normalizedValue = normalizeIdentifierValue(user.email);
  const planned = [
    {
      provider: "email" as const,
      providerId: null,
      issuer: null,
      providerAccountId: null,
      accountId: null,
      occurredAtMs: user.createdAtMs,
      commandId: adoptUserEmailCommandId({ userId: user.id }),
      value: normalizedValue,
      expectedState: user.emailVerified
        ? ("VERIFIED" as const)
        : ("ATTACHED" as const),
    },
    ...accounts.flatMap((account) => {
      const provider = identifierProviderFor(account.provider);
      const adopted = {
        provider,
        providerId: account.provider,
        // The row's own issuer, adopted rather than re-derived. Deriving it
        // here would overwrite a real OIDC issuer with a synthetic one and
        // re-key the very account the adoption is supposed to preserve.
        issuer: account.issuer,
        providerAccountId: account.providerAccountId,
        accountId: account.id,
        occurredAtMs: account.createdAtMs,
        commandId: adoptAccountCommandId({ accountId: account.id }),
        value: normalizedValue,
        expectedState: arrivalStateForProvider(provider),
      };
      const derived = derivedNativeIdentifier({ account, normalizedValue });
      return derived === null ? [adopted] : [adopted, derived];
    }),
  ];
  return planned.map((plan) => ({
    ...plan,
    identifierId: deriveIdentifierId({
      userId: user.id,
      provider: plan.provider,
      providerAccountId: plan.providerAccountId,
      normalizedValue,
      occurredAtMs: plan.occurredAtMs,
    }),
  }));
}

/**
 * The native identifier an Auth0-brokered row ALSO implies (D09), or null
 * where it implies none — the broker's own database users, enterprise
 * connections, and Microsoft, whose issuer only a real token can name.
 *
 * Everything is derived from the source row, so the pass stays restatable:
 * the same business time, an account id parseable back to the source
 * (`derivedAccountId` — the orphan compensation follows the source row's
 * liveness through it), and the issuer the native callback will actually ask
 * for. A user this has run for signs in with the native provider on day one
 * of it being mounted, with no linking ceremony and no second account.
 */
function derivedNativeIdentifier({
  account,
  normalizedValue,
}: {
  account: BackfillAccountRow;
  normalizedValue: string;
}): Omit<PlannedIdentifier, "identifierId"> | null {
  if (account.provider !== "auth0") return null;
  const upstream = upstreamOfAuth0Subject(account.providerAccountId);
  if (upstream === null) return null;
  const provider = identifierProviderFor(upstream.providerId);
  return {
    provider,
    providerId: upstream.providerId,
    issuer: nativeSocialIssuerFor(upstream.providerId),
    providerAccountId: upstream.providerAccountId,
    accountId: derivedAccountId({
      sourceAccountId: account.id,
      providerId: upstream.providerId,
    }),
    occurredAtMs: account.createdAtMs,
    commandId: adoptDerivedAccountCommandId({
      accountId: account.id,
      providerId: upstream.providerId,
    }),
    value: normalizedValue,
    expectedState: arrivalStateForProvider(provider),
  };
}
