import {
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
  private readonly recorder: SignInRoutingRecorder;

  constructor(deps: SignInRouterDeps) {
    this.domains = deps.domains;
    this.policy = deps.policy;
    this.breakGlass = deps.breakGlass;
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
    });

    this.recorder.decided({
      outcome: decision.outcome,
      reasonCode: decision.reasonCode,
      connectionId: decision.connectionId ?? null,
      domain,
      breakGlass,
      breakGlassRateLimited: breakGlass && !granted,
    });

    return decision;
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
