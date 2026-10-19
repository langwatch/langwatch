import { isSsoProviderMatch } from "@langwatch/auth-contract";
import {
  qualifySsoDomainOwnership,
  type SsoConnectionState,
  type SsoMigrationAuthenticationDecision,
  type SsoMigrationLinkRefusalCode,
  type SsoMigrationPhase,
} from "@langwatch/identity-contract";

/** One account presenting itself at a callback. */
export interface MigrationCallbackAccount {
  providerId: string;
  accountId: string;
}

/** A legacy/replacement pair, as the callback policy reads one. */
export interface SsoMigrationCallbackPair {
  replacement: SsoConnectionState;
  legacy: SsoConnectionState;
  /** The provider the grandfathered side authenticates through. */
  legacyProviderId: string;
}

const REPLACEMENT_EXCLUDED_STATES = new Set(["DISCARDED", "TORN_DOWN"]);

/**
 * The pairs an organization is cutting over on. A replacement whose
 * predecessor is missing, is not grandfathered, or names no provider yields
 * NO pair: a caller deciding from half of one decides on absent evidence.
 */
export function migrationCallbackPairs(
  connections: readonly SsoConnectionState[],
): SsoMigrationCallbackPair[] {
  const byId = new Map(connections.map((connection) => [connection.connectionId, connection]));
  return connections.flatMap((replacement) => {
    if (!replacement.replacesConnectionId || !replacement.migrationPhase) return [];
    if (REPLACEMENT_EXCLUDED_STATES.has(replacement.state)) return [];

    const legacy = byId.get(replacement.replacesConnectionId);
    if (!legacy || legacy.organizationId !== replacement.organizationId) return [];
    if (legacy.source !== "legacy-grandfathered") return [];
    const legacyProviderId = legacy.idpMetadata.providerId;
    if (!legacyProviderId) return [];

    return [{ replacement, legacy, legacyProviderId }];
  });
}

/** After this, the grandfathered side authenticates nobody (ADR-117 §6). */
const legacyAuthenticationIsRetired = (phase: SsoMigrationPhase | null): boolean =>
  phase === "FINALIZING" || phase === "FINALIZED";

/** Whether this account is one of the pair's two sides. */
function accountMatchesPair({
  account,
  pair,
}: {
  account: MigrationCallbackAccount;
  pair: SsoMigrationCallbackPair;
}): boolean {
  return (
    account.providerId === pair.replacement.connectionId ||
    isSsoProviderMatch({ ssoProvider: pair.legacyProviderId }, account)
  );
}

/**
 * Whether the replacement's own evidence proves this domain. A verification
 * that does not qualify is not a proof, and reading it as one would carry a
 * cutover on the strength of a row nobody can read back.
 */
export function pairProvesDomain({
  pair,
  domain,
}: {
  pair: SsoMigrationCallbackPair;
  domain: string;
}): boolean {
  return qualifySsoDomainOwnership({ state: pair.replacement, domain }).status === "QUALIFIED";
}

type SsoMigrationLinkPairResolution =
  | { kind: "pair"; pair: SsoMigrationCallbackPair; direct: boolean }
  | { kind: "reject"; code: SsoMigrationLinkRefusalCode };

/**
 * The one pair this account may link through, or the refusal. Exactly one: an
 * account matching several pairs is ambiguous rather than a free choice,
 * because picking one would silently decide which organization it joins.
 */
export function resolveMigrationLinkPair({
  pairs,
  account,
}: {
  pairs: readonly SsoMigrationCallbackPair[];
  account: MigrationCallbackAccount;
}): SsoMigrationLinkPairResolution {
  const matching = pairs.filter((pair) => accountMatchesPair({ account, pair }));
  if (matching.length > 1) return { kind: "reject", code: "SSO_MIGRATION_LINK_AMBIGUOUS" };

  const pair = matching[0];
  if (!pair) return { kind: "reject", code: "SSO_MIGRATION_LINK_NOT_ALLOWED" };

  const direct = account.providerId === pair.replacement.connectionId;
  if (!direct && legacyAuthenticationIsRetired(pair.replacement.migrationPhase)) {
    return { kind: "reject", code: "SSO_LEGACY_AUTH_RETIRED" };
  }
  return { kind: "pair", pair, direct };
}

/**
 * The at-most-two accounts the pair may keep: the one arriving and the one on
 * the other side of the cutover. More than two is ambiguous rather than a
 * reason to pick.
 */
export function keepableAccountsForPair({
  account,
  otherAccounts,
  pair,
}: {
  account: MigrationCallbackAccount;
  otherAccounts: readonly MigrationCallbackAccount[];
  pair: SsoMigrationCallbackPair;
}): { kind: "accounts"; accounts: MigrationCallbackAccount[] } | { kind: "reject" } {
  const onThePair = otherAccounts.filter((other) => accountMatchesPair({ account: other, pair }));
  const exact = new Map<string, MigrationCallbackAccount>();
  for (const candidate of [account, ...onThePair]) {
    exact.set(`${candidate.providerId}\0${candidate.accountId}`, candidate);
  }
  if (exact.size > 2) return { kind: "reject" };
  return { kind: "accounts", accounts: [...exact.values()] };
}

/**
 * The ACTIVE grandfathered connections whose proved domain and provider both
 * name this account. Several is no answer at all, which is why they are
 * counted rather than picked from: the caller refuses on anything but one.
 */
export function findStandaloneLegacyConnections({
  connections,
  account,
  domain,
}: {
  connections: readonly SsoConnectionState[];
  account: MigrationCallbackAccount;
  domain: string;
}): SsoConnectionState[] {
  return connections.filter(
    (connection) =>
      connection.source === "legacy-grandfathered" &&
      connection.state === "ACTIVE" &&
      qualifySsoDomainOwnership({ state: connection, domain }).status === "QUALIFIED" &&
      isSsoProviderMatch({ ssoProvider: connection.idpMetadata.providerId }, account),
  );
}

/** The two paths a connection's own callback arrives on. */
const DIRECT_CALLBACK_MARKERS = ["/sso/callback/", "/sso/saml2/sp/acs/"];

/**
 * Which callback a sign-in path is: the connection's own door, the provider
 * this deployment mounted, or neither. Stated rather than spelled as an
 * absence — most sign-ins are through no callback at all.
 */
type SsoCallbackPathReading =
  | { readonly recognized: true; readonly kind: "direct" | "legacy"; readonly providerId: string }
  | { readonly recognized: false };

const NO_CALLBACK: SsoCallbackPathReading = { recognized: false };

export function ssoCallbackForPath({ path }: { path: string | undefined }): SsoCallbackPathReading {
  if (!path) return NO_CALLBACK;
  for (const marker of DIRECT_CALLBACK_MARKERS) {
    const offset = path.indexOf(marker);
    if (offset < 0) continue;

    const providerId = path.slice(offset + marker.length).split(/[/?#]/)[0];
    return providerId ? { recognized: true, kind: "direct", providerId } : NO_CALLBACK;
  }
  const legacy = /\/callback\/([^/?#]+)/.exec(path);
  return legacy?.[1] ? { recognized: true, kind: "legacy", providerId: legacy[1] } : NO_CALLBACK;
}

/** One connection a callback placed a sign-in on. */
interface AuthenticationMatch {
  connectionId: string;
  organizationId: string;
  replacementPhase: SsoMigrationPhase | null;
  legacy: boolean;
  /** The subject the provider asserted, as the trail records it. */
  providerAccountId: string;
}

/**
 * What one pair makes of one account at this callback. `namedWithoutBinding`
 * is what a bare absence cannot say: the callback names this replacement and
 * the account is not bound to it, which is a refusal rather than a miss.
 */
function matchAuthenticationPair({
  callback,
  account,
  pair,
}: {
  callback: { kind: "direct" | "legacy"; providerId: string };
  account: MigrationCallbackAccount;
  pair: SsoMigrationCallbackPair;
}): { match: AuthenticationMatch | null; namedWithoutBinding: boolean } {
  if (callback.kind === "direct") {
    if (callback.providerId !== pair.replacement.connectionId) {
      return { match: null, namedWithoutBinding: false };
    }
    if (account.providerId !== pair.replacement.connectionId) {
      return { match: null, namedWithoutBinding: true };
    }
    return { match: replacementMatch({ pair, account }), namedWithoutBinding: false };
  }
  if (account.providerId !== callback.providerId) {
    return { match: null, namedWithoutBinding: false };
  }
  if (!isSsoProviderMatch({ ssoProvider: pair.legacyProviderId }, account)) {
    return { match: null, namedWithoutBinding: false };
  }
  return { match: legacyMatch({ pair, account }), namedWithoutBinding: false };
}

const replacementMatch = ({
  pair,
  account,
}: {
  pair: SsoMigrationCallbackPair;
  account: MigrationCallbackAccount;
}): AuthenticationMatch => ({
  connectionId: pair.replacement.connectionId,
  organizationId: pair.replacement.organizationId,
  replacementPhase: pair.replacement.migrationPhase,
  legacy: false,
  providerAccountId: account.accountId,
});

const legacyMatch = ({
  pair,
  account,
}: {
  pair: SsoMigrationCallbackPair;
  account: MigrationCallbackAccount;
}): AuthenticationMatch => ({
  connectionId: pair.legacy.connectionId,
  organizationId: pair.legacy.organizationId,
  replacementPhase: pair.replacement.migrationPhase,
  legacy: true,
  providerAccountId: account.accountId,
});

/** What the sign-in is recorded against, once it is allowed to happen. */
type SsoMigrationAuthenticationOutcome =
  | SsoMigrationAuthenticationDecision
  | {
      action: "record";
      connectionId: string;
      organizationId: string;
      providerAccountId: string;
    };

/**
 * What the pairs, taken together, make of this callback. More than one
 * connection matched cannot be ordered, and recording either would attribute
 * the sign-in to an organization we are guessing at.
 */
export function migrationAuthenticationDecision({
  callback,
  accounts,
  pairs,
}: {
  callback: { kind: "direct" | "legacy"; providerId: string };
  accounts: readonly MigrationCallbackAccount[];
  pairs: readonly SsoMigrationCallbackPair[];
}): SsoMigrationAuthenticationOutcome {
  const outcomes = pairs.flatMap((pair) =>
    accounts.map((account) => matchAuthenticationPair({ callback, account, pair })),
  );
  const namedWithoutBinding =
    outcomes.some((outcome) => outcome.namedWithoutBinding) ||
    namesReplacementWithoutAccount({ callback, accounts, pairs });
  const matched = new Map<string, AuthenticationMatch>();
  for (const { match } of outcomes) if (match) matched.set(match.connectionId, match);

  if (matched.size > 1) return { action: "reject", code: "SSO_MIGRATION_AUTH_AMBIGUOUS" };

  const [match] = matched.values();
  if (!match) {
    return namedWithoutBinding
      ? { action: "reject", code: "SSO_MIGRATION_AUTH_NOT_ALLOWED" }
      : { action: "continue" };
  }
  if (match.legacy && legacyAuthenticationIsRetired(match.replacementPhase)) {
    return { action: "reject", code: "SSO_LEGACY_AUTH_RETIRED" };
  }
  return {
    action: "record",
    connectionId: match.connectionId,
    organizationId: match.organizationId,
    providerAccountId: match.providerAccountId,
  };
}

/** A connection's own door, presented by somebody holding no account on it. */
function namesReplacementWithoutAccount({
  callback,
  accounts,
  pairs,
}: {
  callback: { kind: "direct" | "legacy"; providerId: string };
  accounts: readonly MigrationCallbackAccount[];
  pairs: readonly SsoMigrationCallbackPair[];
}): boolean {
  if (callback.kind !== "direct" || accounts.length > 0) return false;

  return pairs.some((pair) => pair.replacement.connectionId === callback.providerId);
}
