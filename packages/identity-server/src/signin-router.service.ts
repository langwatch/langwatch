import {
  type AccountSignInMethods,
  type RoutableConnection,
  type RoutingDecision,
  type SignInMethodPolicy,
  routeSignIn,
  routingIdentifierOf,
} from "@langwatch/identity";
import { createLogger } from "@langwatch/observability";

const logger = createLogger("langwatch:identity:signin-router");

/**
 * The composition layer over `@langwatch/identity`'s pure router (ADR-117 §1):
 * it assembles the engine's inputs from injected ports, calls the engine, and
 * records the decision. It holds no routing policy of its own — every branch a
 * reviewer might look for is in the engine, where a test enumerates it without
 * a stub in sight.
 *
 * The ports are what make D04 a composition change rather than a router
 * change: today the domain lookup reads `Organization.ssoDomain` strings, and
 * behind `SSOCONN_ROUTING` it reads the `SsoConnection` projection instead.
 * Neither this file nor the engine learns which.
 */

/** Org-level routing data. Never per-user: see the engine's docblock. */
export interface SignInDomainRoutingPort {
  /** The connection owning an email domain, or null when none does — the
   *  same null a domain nobody ever configured produces. */
  findConnectionForDomain(input: {
    domain: string;
  }): Promise<RoutableConnection | null>;
  /** Every connection this instance could auto-redirect to with no address
   *  in hand (the self-hosted sole-connection rule). */
  listActiveConnections(): Promise<readonly RoutableConnection[]>;
}

/** Instance-level method policy, including ADR-027's frozen license gate. */
export interface SignInMethodPolicyPort {
  resolvePolicy(): Promise<SignInMethodPolicy>;
}

/**
 * What the submitted address's account holds (ADR-117, revision 2026-08-25).
 *
 * The one per-user read the router makes, and the reason the revision needed
 * an ADR rather than a patch: this port is the account-existence answer the
 * engine was originally built not to have. It answers KINDS — a password, a
 * passkey, which connections — and never a credential, so what crosses this
 * seam is the same information the method screen is about to draw anyway.
 *
 * `null` means no account holds the address, which is a routing answer rather
 * than an absence: it is what sends somebody to sign-up instead of to a
 * password box they cannot pass.
 */
export interface SignInAccountLookupPort {
  findAccountMethods(input: {
    /** D01's normalization, byte-identical to attach-time. */
    normalizedValue: string;
  }): Promise<AccountSignInMethods | null>;
}

/**
 * The budget on the break-glass bypass (ADR-117 §2: "it is rate-limited,
 * audited").
 *
 * Spending the budget never locks anyone out — it only stops `?local=1` from
 * BYPASSING the auto-redirect, so the request routes the way an ordinary one
 * would. That asymmetry is the point: an operator who needs the local door
 * once gets it, and someone spraying the parameter to farm a password form off
 * an SSO-only deployment gets handed to the IdP like everybody else.
 */
export interface SignInBreakGlassLimiter {
  /** True while the break-glass budget for this window is unspent. */
  allow(): Promise<boolean>;
}

/**
 * Where a decision is recorded. A port rather than a bare logger call so the
 * bake dashboards and the D05 ops surface can take the same feed later
 * without this service learning about either.
 */
export interface SignInRoutingRecorder {
  decided(record: SignInRoutingRecord): void;
}

export interface SignInRoutingRecord {
  outcome: RoutingDecision["outcome"];
  reasonCode: RoutingDecision["reasonCode"];
  connectionId: string | null;
  /**
   * The DOMAIN of the submitted address, never the local part. A domain is an
   * org-level fact routing is decided on and support has to be able to search
   * by; `sam@` is the person, and putting the person in a line that every
   * sign-in attempt writes is how a log becomes a mailing list.
   */
  domain: string | null;
  /** The break-glass audit trail: asked for, and whether it was granted. */
  breakGlass: boolean;
  breakGlassRateLimited: boolean;
  /**
   * WHO walked through the local door — the address as it was submitted —
   * and null on every other sign-in.
   *
   * The deliberate exception to the rule above, and the reason is that the
   * rule's reason does not apply here. `domain` is the org-level fact every
   * ordinary sign-in is decided on, and putting the person in a line written
   * on every attempt is how a log becomes a mailing list. A granted
   * break-glass is not an ordinary attempt: it is rare, it is deliberate, it
   * bypasses the identity provider the organization chose, and ADR-117 §2
   * says it is audited. An audit record that cannot say who used the door is
   * not one.
   */
  breakGlassIdentifier: string | null;
}

const defaultRecorder: SignInRoutingRecorder = {
  decided: (record) => {
    logger.info(record, "sign-in router decided");
  },
};

export interface SignInRouterDeps {
  domains: SignInDomainRoutingPort;
  policy: SignInMethodPolicyPort;
  breakGlass: SignInBreakGlassLimiter;
  accounts: SignInAccountLookupPort;
  recorder?: SignInRoutingRecorder;
}

export interface SignInRouteRequest {
  /** The raw value as it was typed; null when the surface was requested
   *  before any address was asked for. */
  identifier: string | null;
  /** The `?local=1` break-glass path. */
  breakGlass?: boolean;
}

export class SignInRouterService {
  private readonly domains: SignInDomainRoutingPort;
  private readonly policy: SignInMethodPolicyPort;
  private readonly breakGlass: SignInBreakGlassLimiter;
  private readonly accounts: SignInAccountLookupPort;
  private readonly recorder: SignInRoutingRecorder;

  constructor(deps: SignInRouterDeps) {
    this.domains = deps.domains;
    this.policy = deps.policy;
    this.breakGlass = deps.breakGlass;
    this.accounts = deps.accounts;
    this.recorder = deps.recorder ?? defaultRecorder;
  }

  async route({
    identifier,
    breakGlass = false,
  }: SignInRouteRequest): Promise<RoutingDecision> {
    const granted = breakGlass ? await this.breakGlass.allow() : false;
    const routingIdentifier =
      identifier === null ? null : routingIdentifierOf(identifier);
    const domain = routingIdentifier?.domain ?? null;

    const { domainConnection, activeConnections } = granted
      ? // A granted break-glass reads nothing. The door exists for the days
        // the connection store is the thing that is broken, so making it
        // depend on that store would remove it exactly when it is needed.
        { domainConnection: null, activeConnections: [] }
      : await this.lookups({ domain });

    const decision = routeSignIn({
      identifier: routingIdentifier,
      breakGlass: granted,
      policy: await this.policy.resolvePolicy(),
      domainConnection,
      activeConnections,
      account: await this.accountMethods({
        granted,
        routingIdentifier,
        domainConnection,
      }),
    });

    this.recorder.decided({
      outcome: decision.outcome,
      reasonCode: decision.reasonCode,
      connectionId: decision.connectionId ?? null,
      domain,
      breakGlass,
      breakGlassRateLimited: breakGlass && !granted,
      // Only when the door actually opened. A refused break-glass routed like
      // any other request, so there is nothing exceptional to attribute.
      breakGlassIdentifier: granted ? identifier : null,
    });

    return decision;
  }

  /**
   * What the address's account holds, or `undefined` for the cases where the
   * question does not arise.
   *
   * Three of them, and each skip is a decision the engine has already made by
   * the time the account would matter:
   *
   *   - a granted break-glass reads nothing at all, for the same reason it
   *     reads no connections: the door exists for the days the stores are the
   *     broken thing.
   *   - no address means no account to look one up by.
   *   - a domain that a connection owns routes on the domain, live or
   *     suspended, and never reaches the account branch. Asking anyway would
   *     put a second Postgres read on the hot path of exactly the deployments
   *     that route the most sign-ins.
   *
   * So the extra read lands only on an address whose domain nothing owns —
   * which is the only case whose answer it changes. Sign-in was one Postgres
   * read before this and is at most two now (epic R12/R13).
   */
  private async accountMethods({
    granted,
    routingIdentifier,
    domainConnection,
  }: {
    granted: boolean;
    routingIdentifier: { normalized: string } | null;
    domainConnection: RoutableConnection | null;
  }): Promise<AccountSignInMethods | null | undefined> {
    if (granted || routingIdentifier === null || domainConnection !== null) {
      return undefined;
    }
    return this.accounts.findAccountMethods({
      normalizedValue: routingIdentifier.normalized,
    });
  }

  /**
   * Exactly one of the two reads runs: a domain is asked about only when one
   * was submitted, and the sole-connection list only when none was. Sign-in is
   * a hot path (epic R12/R13), so it stays at one Postgres read either way.
   */
  private async lookups({ domain }: { domain: string | null }): Promise<{
    domainConnection: RoutableConnection | null;
    activeConnections: readonly RoutableConnection[];
  }> {
    if (domain) {
      return {
        domainConnection: await this.domains.findConnectionForDomain({
          domain,
        }),
        activeConnections: [],
      };
    }
    return {
      domainConnection: null,
      activeConnections: await this.domains.listActiveConnections(),
    };
  }
}
