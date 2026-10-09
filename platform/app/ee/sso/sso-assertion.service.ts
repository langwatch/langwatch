// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { extractEmailDomain } from "@ee/sso/matching";
import {
  isConfiguredLegacySsoRoute,
  isSsoConnectionInSetup,
  looksLikeSsoConnectionId,
  normalizeDomain,
  qualifySsoDomainOwnership,
  type SsoAssertionRefusedError,
  SsoAssertionWithoutAddressError,
  type SsoConnectionSource,
  SsoDomainNotVerifiedError,
  SsoDomainProofLapsedError,
  type SsoDomainVerification,
  SsoSetupAddressMismatchError,
  SsoSignInRefusedError,
} from "@langwatch/identity";
import { createLogger } from "@langwatch/observability";

const logger = createLogger("langwatch:identity:sso-assertion");

/**
 * One connection, as the two sign-in decisions read it.
 *
 * Both used to select their own subset of the same row, and the two subsets
 * drifted: the gate never learned about `lapsedDomains` and the arrival never
 * learned about `createdBy`. One shape, read once, and each decision says
 * which parts of it it acts on.
 */
export interface SignInConnection {
  connectionId?: string;
  organizationId: string;
  replacesConnectionId?: string | null;
  state: string;
  verifiedDomains: readonly string[];
  domainVerifications: readonly SsoDomainVerification[];
  lapsedDomains: readonly string[];
  arrivalPolicy: string;
  /** When somebody CHOSE what this connection does with an arrival, as
   *  opposed to the default standing. One of the go-live preconditions. */
  arrivalPolicyDecidedAtMs?: number | null;
  createdBy: string | null;
  source: SsoConnectionSource;
  providerId: string;
}

export interface SignInConnectionReadsPort {
  /** The connection an assertion names, or null when we hold no such row. */
  findConnectionForSignIn(args: {
    connectionId: string;
  }): Promise<SignInConnection | null>;
}

export interface SsoRegistrantMembershipPort {
  /**
   * Whether this address belongs to the named person, who is still a member
   * of the named organization.
   */
  findRegistrantAtAddress(args: {
    organizationId: string;
    userId: string;
    email: string;
  }): Promise<boolean>;
  /** Whether this exact connection subject was already bound to a current
   * member at the asserted address before ownership evidence lapsed. */
  findBoundMemberIdentity(args: {
    organizationId: string;
    connectionId: string;
    accountId: string;
    email: string;
  }): Promise<boolean>;
}

/**
 * What one connection's stored state says about one domain — the single
 * reading both sign-in decisions make of it.
 *
 * Three facts rather than one verdict, because the two decisions weigh them
 * differently and ADR-123 says they must: a lapsed domain still ROUTES, so
 * people who already work there keep signing in, and stops PROVISIONING, so
 * it admits nobody new. Collapsing them to "may this connection act on this
 * domain" would make one of the two wrong.
 */
export const domainStanding = ({
  connection,
  domain,
}: {
  connection: Pick<
    SignInConnection,
    | "state"
    | "connectionId"
    | "organizationId"
    | "replacesConnectionId"
    | "verifiedDomains"
    | "domainVerifications"
    | "lapsedDomains"
    | "source"
  >;
  domain: string;
}): { live: boolean; proved: boolean; lapsed: boolean } => ({
  live: connection.state === "ACTIVE",
  proved:
    qualifySsoDomainOwnership({ state: connection, domain }).status ===
    "QUALIFIED",
  lapsed: connection.lapsedDomains.includes(domain),
});

/**
 * Asks for one domain's published record to be read again, out of band.
 *
 * A refusal for a lapsed proof is evidence that somebody is being turned away
 * RIGHT NOW, which the eight-hourly sweep has no way to know — and the record
 * is very often simply back. The request is an intent behind the outbox lease
 * rather than a lookup here: a sign-in path must never wait on somebody else's
 * nameservers, and a provider stuck in a redirect loop must not turn into a
 * burst of queries against them.
 */
export interface SsoDomainReproofRequestPort {
  requestReproof(args: { connectionId: string; domain: string }): Promise<void>;
}

/**
 * Whether the organization still has a way in that does not go through the
 * identity provider — the go-live precondition this gate cannot read off the
 * connection row.
 */
export interface SsoBreakGlassReadinessPort {
  hasLiveBreakGlass(args: { organizationId: string }): Promise<boolean>;
}

export interface SsoAssertionServiceDeps {
  connections: SignInConnectionReadsPort;
  memberships: SsoRegistrantMembershipPort;
  /** Absent in the suites that do not exercise the lapsed path. */
  reproof?: SsoDomainReproofRequestPort;
  /**
   * Absent means NO break-glass, which makes `setupIsComplete` false and
   * leaves the gate behaving exactly as it did before that rule existed. The
   * safe direction for an unwired dependency to fail in is closed.
   */
  breakGlass?: SsoBreakGlassReadinessPort;
}

/** Internal reasons identify the failure; customer errors expose actionable detail. */
export type SsoAssertionRefusalReason =
  | "provider-is-not-a-connection"
  | "assertion-carried-no-address"
  | "connection-not-found"
  | "connection-not-accepting-sign-in"
  | "connection-has-no-registrant"
  | "setup-address-mismatch"
  | "domain-not-verified"
  | "domain-proof-lapsed";

export interface SsoAssertionRefusal {
  action: "reject";
  reason: SsoAssertionRefusalReason;
  /** The refusal as the rest of the platform states one; the seam that
   *  answers the plugin reads its `code`. */
  error: SsoAssertionRefusedError;
}

export type SsoAssertionDecision = { action: "continue" } | SsoAssertionRefusal;

/**
 * The refusal each reason is answered with, and how loudly it is logged.
 *
 * THE RULE: a cause is named when it is a fact about the caller's own
 * assertion or their own organization's configuration — something they or
 * their administrator can change. It stays opaque when it would answer "does
 * this exist inside LangWatch", because a refusal that distinguished those is
 * how connection identifiers get enumerated.
 */
const REFUSALS: Record<
  SsoAssertionRefusalReason,
  {
    error: (detail: string) => SsoAssertionRefusedError;
    level: "info" | "warn" | "error";
  }
> = {
  // Named: facts about their own assertion or configuration.
  "assertion-carried-no-address": {
    error: (detail) => new SsoAssertionWithoutAddressError(detail),
    level: "info",
  },
  "setup-address-mismatch": {
    error: (detail) => new SsoSetupAddressMismatchError(detail),
    level: "info",
  },
  "domain-not-verified": {
    error: (detail) => new SsoDomainNotVerifiedError(detail),
    level: "info",
  },
  "domain-proof-lapsed": {
    error: (detail) => new SsoDomainProofLapsedError(detail),
    level: "info",
  },

  // Opaque: each would answer "does this exist inside LangWatch".
  "provider-is-not-a-connection": {
    error: (detail) => new SsoSignInRefusedError(detail),
    // Odd rather than routine — our own surfaces do not produce it — so it is
    // worth seeing without being worth paging anybody over.
    level: "warn",
  },
  "connection-not-found": {
    error: (detail) => new SsoSignInRefusedError(detail),
    level: "warn",
  },
  "connection-not-accepting-sign-in": {
    error: (detail) => new SsoSignInRefusedError(detail),
    level: "warn",
  },
  "connection-has-no-registrant": {
    error: (detail) => new SsoSignInRefusedError(detail),
    // OURS, not theirs. A connection with nobody recorded as having
    // registered it should not exist; the customer cannot act on it and must
    // not be told about it, but it is not a refusal to shrug at either.
    level: "error",
  },
};

/**
 * Whether an assertion from a customer's identity provider may become a
 * session at all — asked BEFORE better-auth links it to anybody.
 *
 * This is the only place that asks. `SsoArrivalService` compares the asserted
 * domain against the connection's proved domains too, but it runs after the
 * link has already happened, and it decides organization membership rather
 * than identity. That ordering was an account takeover: `trustEmailVerified`
 * makes `emailVerified` the CUSTOMER'S OWN identity provider's word,
 * better-auth links a verified address onto an existing user, and a
 * connection is dialable from DRAFT — so anybody who could register a
 * connection could point it at a server they control, assert
 * `someone-else@their-company.com` with `email_verified: true`, and be handed
 * that person's session.
 */
export class SsoAssertionService {
  constructor(private readonly deps: SsoAssertionServiceDeps) {}

  /**
   * Two questions, and the second is why this is not simply "is the domain
   * proved":
   *
   *   - A LIVE connection may only assert addresses on domains it has proved.
   *     Nothing else is defensible; the proof is the entire basis for trusting
   *     the flag.
   *
   *   - A connection that is NOT live may only assert ONE address: the one
   *     belonging to the administrator who registered it. This is the setup
   *     journey and nothing wider: activation refuses without a real sign-in
   *     through the connection (`SsoActivationTestSignInMissingError`), so the
   *     administrator doing the setup has to be able to sign in before the
   *     domain is proved — and proving the round trip works takes exactly one
   *     person, the one doing it.
   *
   *     ANY MEMBER IS NOT THE RULE, and reading it that way was an account
   *     takeover of a colleague. An administrator holding `sso:manage` can
   *     point a DRAFT connection at a server they control; if the gate admits
   *     every address in their organization, they assert a co-worker's address
   *     with `email_verified: true` and are handed that co-worker's session —
   *     including the co-worker's access to every OTHER organization and
   *     project they belong to, which the administrator never had. The threat
   *     the setup exemption has to survive is a colleague, not a stranger.
   *
   * The refusal is deliberately one code for every cause. Which of the two
   * questions failed is not something an unauthenticated caller gets to learn.
   */
  async decide({
    providerId,
    accountId,
    email,
  }: {
    providerId: string;
    accountId?: string;
    email: string | null | undefined;
  }): Promise<SsoAssertionDecision> {
    const carryOn = { action: "continue" } as const;

    // Not a connection at all: the deployment's own brokered provider and the
    // generic OAuth path do not come through this plugin, and an id that is not
    // a connection's reaching it is not something to wave past.
    if (!looksLikeSsoConnectionId(providerId)) {
      return this.refuse({
        reason: "provider-is-not-a-connection",
        providerId,
        detail: "the asserted provider is not a connection identifier",
      });
    }

    const raw = extractEmailDomain(email);
    if (!raw) {
      return this.refuse({
        reason: "assertion-carried-no-address",
        providerId,
        detail: "the assertion carried no email address to match on",
      });
    }
    // Folded the way a claimed domain is folded, or a trailing dot and a
    // unicode homograph both compare unequal to the domain they impersonate.
    const domain = normalizeDomain(raw);

    const connection = await this.deps.connections.findConnectionForSignIn({
      connectionId: providerId,
    });
    if (!connection) {
      return this.refuse({
        reason: "connection-not-found",
        providerId,
        domain,
        detail: "no connection is held under the asserted identifier",
      });
    }

    // A lapsed domain is not consulted here on purpose (ADR-123): the people
    // who already work there keep signing in.
    const standing = domainStanding({ connection, domain });
    if (
      standing.live ||
      (await this.setupIsComplete({ connection, standing }))
    ) {
      return await this.decideForLiveDomain({
        connection,
        providerId,
        standing,
        domain,
        accountId,
        email,
      });
    }

    // A connection that is no longer on the setup path cannot accept an
    // assertion. Suspension and teardown remove its dialable provider, but
    // this gate still has to refuse an in-flight callback or a stale direct
    // callback after that removal. The registrant exception belongs only to
    // the setup states in the aggregate's explicit allowlist.
    if (!isSsoConnectionInSetup(connection.state)) {
      return this.refuse({
        reason: "connection-not-accepting-sign-in",
        providerId,
        domain,
        organizationId: connection.organizationId,
        detail: `the connection is ${connection.state} and no longer accepts sign-in assertions`,
      });
    }

    // A connection nobody is recorded as having registered has no setup
    // administrator to make an exception for. Grandfathered connections end
    // ACTIVE and never reach here, so this is a row that should not exist
    // rather than a shape to wave through.
    if (!connection.createdBy) {
      return this.refuse({
        reason: "connection-has-no-registrant",
        providerId,
        domain,
        organizationId: connection.organizationId,
        detail: "the connection records nobody as having registered it",
      });
    }

    const setupAdministrator =
      await this.deps.memberships.findRegistrantAtAddress({
        organizationId: connection.organizationId,
        userId: connection.createdBy,
        email: email ?? "",
      });
    if (setupAdministrator) return carryOn;

    return this.refuse({
      reason: "setup-address-mismatch",
      providerId,
      domain,
      organizationId: connection.organizationId,
      detail:
        "the connection is not live and the asserted address is not the registrant's",
    });
  }

  /**
   * The answer when the connection already claims this domain.
   *
   * A proved domain, or a legacy route whose imported set carried it, goes
   * straight through. A LAPSED domain is the interesting case (ADR-123): the
   * people who already work there keep signing in, so an account already bound
   * to this connection continues, and only an unrecognised one is refused.
   * Without an `accountId` there is nothing to recognise, so there is nothing
   * to let through.
   */
  private async decideForLiveDomain({
    connection,
    providerId,
    standing,
    domain,
    accountId,
    email,
  }: {
    connection: SignInConnection;
    providerId: string;
    standing: { proved: boolean; lapsed: boolean };
    domain: string;
    accountId: string | undefined;
    email: string | null | undefined;
  }): Promise<SsoAssertionDecision> {
    const carryOn = { action: "continue" } as const;

    const legacyCompatibility =
      isConfiguredLegacySsoRoute({
        source: connection.source,
        providerId: connection.providerId,
      }) && connection.verifiedDomains.includes(domain);
    if (standing.proved || legacyCompatibility) return carryOn;

    if (!standing.lapsed) {
      return this.refuse({
        reason: "domain-not-verified",
        providerId,
        domain,
        organizationId: connection.organizationId,
        detail: "the connection has never proved the asserted domain",
      });
    }

    // Without an `accountId` there is nothing to recognise, so there is
    // nothing to let through — and that is a lapsed-proof refusal rather than
    // a different one, because the lapse is what closed the door.
    const alreadyBound =
      accountId !== undefined &&
      (await this.deps.memberships.findBoundMemberIdentity({
        organizationId: connection.organizationId,
        connectionId: providerId,
        accountId,
        email: email ?? "",
      }));
    if (alreadyBound) return carryOn;

    // Asked for BEFORE the refusal is returned rather than after, so this is
    // an awaited outbox write and not a promise left floating past the end of
    // the request. It is a local insert; the nameserver read happens behind
    // the lease, on somebody else's time.
    await this.requestReproof({ connectionId: providerId, domain });

    return this.refuse({
      reason: "domain-proof-lapsed",
      providerId,
      domain,
      organizationId: connection.organizationId,
      detail: "the domain's published record lapsed and this account is new",
    });
  }

  /**
   * Whether this connection has done EVERYTHING activation asks of it except
   * the sign-in currently being attempted.
   *
   * THE DEADLOCK THIS BREAKS. Activation refuses without a real sign-in
   * through the connection, and a connection that is not ACTIVE used to
   * accept exactly one address — the one on the account that registered it.
   * So an administrator whose identity provider asserts anything other than
   * their own LangWatch address could never finish setup: the sign-in needed
   * to activate was refused because the connection was not activated. Every
   * screen told them to verify the domain, and verifying it released nothing,
   * because a proved domain was only ever consulted once the connection was
   * already live.
   *
   * AND IT IS NOT A WIDENING OF WHO GETS ROUTED. `routingStateOf` answers
   * ACTIVE for `state === "ACTIVE"` and INACTIVE for everything else, and
   * nothing here touches it — so no ordinary sign-in changes door. This only
   * decides whether an assertion that DELIBERATELY dialed this connection is
   * accepted, which before activation is the administrator proving it works.
   *
   * The conditions are activation's own, minus the sign-in: the connection
   * still on the setup path, this exact domain proved, somebody has said what
   * happens to an arrival, and the organization still has a way in that does
   * not go through the identity provider. The proof is what makes trusting the provider's word defensible
   * in the first place; the other two are what stop a connection admitting
   * people into a decision nobody has made, or stranding them if it goes
   * wrong.
   *
   * ORDERED SO THE COMMON PATH COSTS NOTHING. Both in-memory facts are asked
   * before the break-glass read, so a connection that has proved nothing
   * never makes a query to find that out.
   */
  private async setupIsComplete({
    connection,
    standing,
  }: {
    connection: SignInConnection;
    standing: { proved: boolean };
  }): Promise<boolean> {
    // Readiness is the SETUP journey's exemption and nothing else. The fold
    // preserves proof, the arrival decision and the break-glass grant through
    // suspension and teardown, so without this a closed connection still
    // satisfies every remaining condition and an in-flight callback walks
    // past the refusal below (ADR-123).
    if (!isSsoConnectionInSetup(connection.state)) return false;
    if (!standing.proved) return false;
    // Somebody has SAID, which is not the same as the connection having an
    // answer — it always has one. A connection that predates the question is
    // on `refuse` and nobody chose it.
    if (!connection.arrivalPolicyDecidedAtMs) return false;
    if (!this.deps.breakGlass) return false;
    return await this.deps.breakGlass.hasLiveBreakGlass({
      organizationId: connection.organizationId,
    });
  }

  /** Log the refusal and domain without collecting the asserted email address. */
  private refuse({
    reason,
    providerId,
    domain,
    organizationId,
    detail,
  }: {
    reason: SsoAssertionRefusalReason;
    providerId: string;
    domain?: string;
    organizationId?: string;
    detail: string;
  }): SsoAssertionRefusal {
    const refusal = REFUSALS[reason];
    logger[refusal.level](
      { reason, providerId, organizationId, domain },
      `single sign-on assertion refused: ${detail}`,
    );
    return { action: "reject", reason, error: refusal.error(detail) };
  }

  /** Never lets a failed request become a failed sign-in: the refusal stands
   *  either way, and a 403 turning into a 500 would lose its words. */
  private async requestReproof(args: {
    connectionId: string;
    domain: string;
  }): Promise<void> {
    try {
      await this.deps.reproof?.requestReproof(args);
    } catch (error) {
      logger.warn(
        { error, ...args },
        "could not ask for a lapsed domain to be read again",
      );
    }
  }
}
