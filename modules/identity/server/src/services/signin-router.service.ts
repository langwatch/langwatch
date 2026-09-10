import {
  type RoutableConnection,
  type RoutingDecision,
  type SignInMethodPolicy,
  routeSignIn,
  routingIdentifierOf,
} from "@langwatch/identity-contract";
import { createLogger } from "@langwatch/observability";

const logger = createLogger("langwatch:identity:signin-router");

/**
 * The composition layer over `@langwatch/identity-contract`'s pure router (ADR-117 §1):
 */

/** Org-level routing data. Never per-user: see the engine's docblock. */
export interface SignInDomainRouting {
  /** The connection owning an email domain, or null when none does — the
   *  same null a domain nobody ever configured produces. */
  tryFindConnectionForDomain(input: { domain: string }): Promise<RoutableConnection | null>;
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
   * The DOMAIN of the submitted address, never the local part.
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
  domains: SignInDomainRouting;
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
  static create(deps: SignInRouterDeps): SignInRouterService {
    return new SignInRouterService(deps);
  }

  private readonly domains: SignInDomainRouting;
  private readonly policy: SignInMethodPolicyPort;
  private readonly breakGlass: SignInBreakGlassLimiter;
  private readonly recorder: SignInRoutingRecorder;

  private constructor(deps: SignInRouterDeps) {
    this.domains = deps.domains;
    this.policy = deps.policy;
    this.breakGlass = deps.breakGlass;
    this.recorder = deps.recorder ?? defaultRecorder;
  }

  async route({ identifier, breakGlass = false }: SignInRouteRequest): Promise<RoutingDecision> {
    const granted = breakGlass ? await this.breakGlass.allow() : false;
    const routingIdentifier = identifier === null ? null : routingIdentifierOf(identifier);
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
        domainConnection: await this.domains.tryFindConnectionForDomain({
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
