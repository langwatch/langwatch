import {
  isConfiguredLegacySsoRoute,
  isSsoConnectionInSetup,
  looksLikeSsoConnectionId,
  normalizeDomain,
  type SsoAssertionDecision,
  type SsoAssertionRefusal,
  type SsoAssertionRefusalReason,
  type SsoAssertionRefusedError,
  SsoAssertionWithoutAddressError,
  type SsoConnectionState,
  SsoDomainNotVerifiedError,
  SsoDomainProofLapsedError,
  ssoDomainStanding,
  SsoSetupAddressMismatchError,
  SsoSignInRefusedError,
} from "@langwatch/identity-contract";
import { createLogger } from "@langwatch/observability";

import type {
  SsoBreakGlassBindingRepository,
  SsoConnectionReadRepository,
} from "../repositories/sso-connection.repository.ts";
import type {
  SsoDomainReproofRequest,
  SsoRegistrantReads,
} from "../rules/sso-assertion-contract.rules.ts";

const logger = createLogger("langwatch:identity:sso-assertion");

/**
 * The refusal each reason is answered with, and how loudly it is logged. A
 * cause stays opaque when naming it would say what exists inside LangWatch,
 * because that is how connection identifiers get enumerated.
 */
const REFUSALS: Record<
  SsoAssertionRefusalReason,
  { error: (detail: string) => SsoAssertionRefusedError; level: "info" | "warn" | "error" }
> = {
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

  // Odd rather than routine — our own surfaces do not produce it — so worth
  // seeing without being worth paging anybody over.
  "provider-is-not-a-connection": {
    error: (detail) => new SsoSignInRefusedError(detail),
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
  // OURS, not theirs: a connection with nobody recorded as having registered
  // it should not exist. The customer cannot act on it and must not be told.
  "connection-has-no-registrant": {
    error: (detail) => new SsoSignInRefusedError(detail),
    level: "error",
  },
};

export interface SsoAssertionServiceDeps {
  connections: SsoConnectionReadRepository;
  registrants: SsoRegistrantReads;
  /** Absent in the suites that do not exercise the lapsed path. */
  reproof?: SsoDomainReproofRequest;
  /**
   * Absent means NO break-glass, which makes `setupIsComplete` false and
   * leaves the gate behaving as it did before that rule existed. The safe
   * direction for an unwired dependency to fail in is closed.
   */
  breakGlass?: SsoBreakGlassBindingRepository;
}

/**
 * Whether an assertion may become a session at all — asked BEFORE anything
 * links it to a person. The arrival service runs after the link and decides
 * membership rather than identity; that ordering was an account takeover.
 */
export class SsoAssertionService {
  static create(deps: SsoAssertionServiceDeps): SsoAssertionService {
    return new SsoAssertionService(deps);
  }

  private constructor(private readonly deps: SsoAssertionServiceDeps) {}

  /**
   * Two questions: a LIVE connection may only assert addresses on domains it
   * PROVED, and one that is not live may only assert the registrant's — any
   * member is NOT the rule, and reading it so took a colleague's account.
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
    // generic OAuth path do not come through this seam.
    if (!looksLikeSsoConnectionId(providerId)) {
      return this.refuse({
        reason: "provider-is-not-a-connection",
        providerId,
        detail: "the asserted provider is not a connection identifier",
      });
    }

    // Folded the way a claimed domain is folded, or a trailing dot and a
    // unicode homograph both compare unequal to what they impersonate.
    const asserted = readAssertedDomain(email);
    if (!asserted.matched) {
      return this.refuse({
        reason: "assertion-carried-no-address",
        providerId,
        detail: "the assertion carried no email address to match on",
      });
    }
    const { domain } = asserted;

    const connection = await this.deps.connections.tryFindConnection({ connectionId: providerId });
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
    const standing = ssoDomainStanding({ connection, domain });
    if (standing.live || (await this.setupIsComplete({ connection, standing }))) {
      return this.decideForClaimedDomain({
        connection,
        providerId,
        standing,
        domain,
        accountId,
        email,
      });
    }

    // Suspension and teardown remove the dialable provider, but this gate
    // still has to refuse an in-flight or stale direct callback after that.
    if (!isSsoConnectionInSetup(connection.state)) {
      return this.refuse({
        reason: "connection-not-accepting-sign-in",
        providerId,
        domain,
        organizationId: connection.organizationId,
        detail: `the connection is ${connection.state} and no longer accepts sign-in assertions`,
      });
    }

    // A connection nobody registered has no setup administrator to make an
    // exception for. Grandfathered connections end ACTIVE and never get here.
    if (!connection.createdBy) {
      return this.refuse({
        reason: "connection-has-no-registrant",
        providerId,
        domain,
        organizationId: connection.organizationId,
        detail: "the connection records nobody as having registered it",
      });
    }

    const registrant = await this.deps.registrants.findRegistrantAtAddress({
      organizationId: connection.organizationId,
      userId: connection.createdBy,
      email: email ?? "",
    });
    if (registrant) return carryOn;

    return this.refuse({
      reason: "setup-address-mismatch",
      providerId,
      domain,
      organizationId: connection.organizationId,
      detail: "the connection is not live and the asserted address is not the registrant's",
    });
  }

  /**
   * A proved domain, or a legacy route whose imported set carried it, goes
   * straight through. On a LAPSED one (ADR-123) an account already bound to
   * this connection continues and only an unrecognised one is refused.
   */
  private async decideForClaimedDomain({
    connection,
    providerId,
    standing,
    domain,
    accountId,
    email,
  }: {
    connection: SsoConnectionState;
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
        providerId: connection.idpMetadata.providerId,
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
    // nothing to let through — and that is a lapsed-proof refusal, because
    // the lapse is what closed the door.
    const alreadyBound =
      accountId !== undefined &&
      (await this.deps.registrants.findBoundMemberIdentity({
        organizationId: connection.organizationId,
        connectionId: providerId,
        accountId,
        email: email ?? "",
      }));
    if (alreadyBound) return carryOn;

    // Asked for BEFORE the refusal is returned, so this is an awaited local
    // write and not a promise left floating past the end of the request.
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
   * Whether this connection has done EVERYTHING activation asks except the
   * sign-in being attempted — activation refuses without a real sign-in, and
   * a connection that was not ACTIVE took only the registrant's address.
   */
  private async setupIsComplete({
    connection,
    standing,
  }: {
    connection: SsoConnectionState;
    standing: { proved: boolean };
  }): Promise<boolean> {
    // The SETUP journey's exemption and nothing else: the fold preserves
    // proof, arrival answer and break-glass through suspension and teardown,
    // so without this a closed connection still satisfies the rest (ADR-123).
    if (!isSsoConnectionInSetup(connection.state)) return false;
    if (!standing.proved) return false;
    // Somebody has SAID, which is not the connection having an answer — it
    // always has one. A connection that predates the question is on `refuse`.
    if (!connection.arrivalPolicyDecidedAtMs) return false;
    if (!this.deps.breakGlass) return false;
    return this.deps.breakGlass.hasLiveBinding({ organizationId: connection.organizationId });
  }

  /** Logs the refusal and the domain without collecting the asserted address. */
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
  private async requestReproof(args: { connectionId: string; domain: string }): Promise<void> {
    try {
      await this.deps.reproof?.requestReproof(args);
    } catch (error) {
      logger.warn({ error, ...args }, "could not ask for a lapsed domain to be read again");
    }
  }
}

/** Whether an assertion carried an address a domain can be read from. */
type AssertedDomainRead =
  | Readonly<{ matched: true; domain: string }>
  | Readonly<{ matched: false }>;

/**
 * Exactly one at-sign, folded the way a claimed domain is folded — or a
 * trailing dot and a unicode homograph compare unequal to what they
 * impersonate. `matched: false` is a refusal the caller states, not an absence.
 */
function readAssertedDomain(email: string | null | undefined): AssertedDomainRead {
  if (!email) return { matched: false };
  const at = email.indexOf("@");
  if (at <= 0 || at === email.length - 1 || at !== email.lastIndexOf("@")) {
    return { matched: false };
  }
  return { matched: true, domain: normalizeDomain(email.slice(at + 1)) };
}
