import {
  type AccountSignInMethods,
  type RoutableConnection,
  type RoutingDecision,
  type SignInMethodPolicyResolver,
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
  /** The connection owning an email domain: one, after a migrating pair is
   *  collapsed to the side sign-in goes through, and none when nothing owns
   *  it - the same emptiness a domain nobody ever configured produces. */
  findConnectionsForDomain(input: { domain: string }): Promise<readonly RoutableConnection[]>;
  /** Every connection this instance could auto-redirect to with no address
   *  in hand (the self-hosted sole-connection rule). */
  findActiveConnections(): Promise<readonly RoutableConnection[]>;
}

/**
 * What the submitted address's account holds (ADR-117). The one per-user
 * read the router makes: answers KINDS, never a credential. `null` means no
 * account holds the address — routes to sign-up, not a password box.
 */
export interface SignInAccountLookup {
  findAccountMethods(input: {
    /** D01's normalization, byte-identical to attach-time. */
    normalizedValue: string;
  }): Promise<AccountSignInMethods | null>;
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
  /**
   * WHO walked through the local door, null on every other sign-in — naming
   * the person on every attempt would turn the log into a mailing list.
   * ADR-117 §2 requires break-glass audited by who used the door.
   */
  breakGlassIdentifier: string | null;
}

const defaultRecorder: SignInRoutingRecorder = {
  decided: (record) => {
    logger.info(record, "sign-in router decided");
  },
};

export interface SignInRouterDeps {
  domains: SignInDomainRouting;
  policy: SignInMethodPolicyResolver;
  breakGlass: SignInBreakGlassLimiter;
  accounts: SignInAccountLookup;
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
  private readonly policy: SignInMethodPolicyResolver;
  private readonly breakGlass: SignInBreakGlassLimiter;
  private readonly accounts: SignInAccountLookup;
  private readonly recorder: SignInRoutingRecorder;

  private constructor(deps: SignInRouterDeps) {
    this.domains = deps.domains;
    this.policy = deps.policy;
    this.breakGlass = deps.breakGlass;
    this.accounts = deps.accounts;
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
   * What the address's account holds, or `undefined` when the question does
   * not arise: break-glass, no address, or a domain already owned. The extra
   * read lands only where nothing owns the domain (R12/R13).
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
      const [domainConnection] = await this.domains.findConnectionsForDomain({
        domain,
      });

      return { domainConnection: domainConnection ?? null, activeConnections: [] };
    }

    return {
      domainConnection: null,
      activeConnections: await this.domains.findActiveConnections(),
    };
  }
}
