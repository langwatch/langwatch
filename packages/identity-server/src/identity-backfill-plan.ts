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
  const nativeSubjects = nativeSubjectsOf({ accounts });
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
      const derived = derivedNativeIdentifier({
        account,
        normalizedValue,
        nativeSubjects,
      });
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
  nativeSubjects,
}: {
  account: BackfillAccountRow;
  normalizedValue: string;
  /** The pairs real native rows already assert — see `planIdentifiers`. */
  nativeSubjects: ReadonlySet<string>;
}): Omit<PlannedIdentifier, "identifierId"> | null {
  if (account.provider !== "auth0") return null;
  const upstream = upstreamOfAuth0Subject(account.providerAccountId);
  if (upstream === null) return null;
  if (
    nativeSubjects.has(
      `${upstream.providerId}\u0000${upstream.providerAccountId}`,
    )
  ) {
    return null;
  }
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


/**
 * Every (provider, subject) pair a REAL native `Account` row already asserts.
 *
 * The derivation stands down for these: the native providers are mounted
 * beside the broker, so a user can hold both `auth0 · google-oauth2|X` and a
 * native `google · X` row, and a second live identifier for the same pair
 * would hit the projection's live unique index — the loser parks, the parity
 * diff never clears, and the user is held at `migrated` forever. The adopted
 * native row already states everything the derivation would have.
 */
function nativeSubjectsOf({
  accounts,
}: {
  accounts: BackfillAccountRow[];
}): ReadonlySet<string> {
  return new Set(
    accounts
      .filter((account) => account.provider !== "auth0")
      .map((account) => `${account.provider}\u0000${account.providerAccountId}`),
  );
}

/**
 * The derived identifiers a REAL native row has overtaken, named by the
 * account id each one carries — what the compensation detaches so the real
 * row's identifier can take the subject.
 *
 * Standing the derivation down is not enough on its own. It keeps one pass
 * from stating both facts at once; it says nothing about a derived identifier
 * an EARLIER pass already wrote, back when the broker row was the only thing
 * asserting that subject. That row stays live — its source broker row is
 * still live, so the orphan compensation does not touch it — and it holds the
 * subject against the adopted identifier the native row implies, which
 * carries the native row's own business time and therefore a different id.
 * The attach collides on every pass, the loser parks, the parity diff never
 * clears, and the user never finalizes: their secrets are never carried
 * across and they stay on the legacy path indefinitely.
 *
 * Detaching toward the REAL row rather than away from it, because that row is
 * the stronger statement of the same fact. It is the provider's own account
 * as better-auth wrote it, it can hold tokens, and it outlives the broker's
 * teardown — while the derived identifier was only ever an inference standing
 * in until a native sign-in happened. It has happened. This is the D10
 * constraint read from the far end: the derived identifier is retired once,
 * by the very row it was predicting.
 */
export function supersededDerivedAccountIds({
  accounts,
}: {
  accounts: BackfillAccountRow[];
}): ReadonlySet<string> {
  const nativeSubjects = nativeSubjectsOf({ accounts });
  const superseded = new Set<string>();
  for (const account of accounts) {
    if (account.provider !== "auth0") continue;
    const upstream = upstreamOfAuth0Subject(account.providerAccountId);
    if (upstream === null) continue;
    if (
      !nativeSubjects.has(
        `${upstream.providerId}\u0000${upstream.providerAccountId}`,
      )
    ) {
      continue;
    }
    superseded.add(
      derivedAccountId({
        sourceAccountId: account.id,
        providerId: upstream.providerId,
      }),
    );
  }
  return superseded;
}
