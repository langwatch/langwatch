import { identifierDomain, normalizeIdentifierValue } from "./identifier";

/**
 * The identifier-first sign-in router (D03, ADR-117 §1): a PURE decision
 * engine. Email in, decision out — no Prisma, no env, no framework, no clock,
 * and deliberately no user-level read of any kind.
 *
 * Everything the engine needs is assembled by a composition layer from two
 * injected ports: an org-level domain lookup and an instance-level method
 * policy. That split is the whole point of ADR-117 §1's "the router carries
 * no per-user fork": domain routing is ORG data, method policy is INSTANCE
 * data, and resolving a *person* — sign-in by any verified email, an OAuth
 * subject — belongs to the ADR-116 storage adapter, which forks per user
 * inside itself. A router that read `Identifier` would be an account-existence
 * oracle wearing a routing hat.
 *
 * Because the engine sees no user data, ADR-117 §2 holds by construction
 * rather than by care: an unknown address and a known one on the same
 * non-routing domain produce the same decision object, field for field.
 * There is no branch here that could tell them apart.
 */

/**
 * The reason vocabulary. Codes are VOCABULARY, not copy — the customer-facing
 * words live in the app's presentation registry keyed by error code, and the
 * screens (D13) key their guidance states off these. A screen that needs a new
 * behavior needs a new reason code first (ADR-117 §6).
 */
export const SIGNIN_ROUTING_REASON_CODES = [
  /** Self-hosted, no email asked yet, exactly one connection can serve it. */
  "sole_active_connection",
  /** `?local=1` — the local method set, whatever else would have routed. */
  "break_glass",
  /** The submitted address's domain belongs to a live connection. */
  "domain_routed",
  /** Nothing routes the domain: the uniform picker, which is also the answer
   *  for an address no account exists for. */
  "no_domain_match",
  /** A connection owns the domain but is not routing traffic right now. */
  "connection_suspended",
  /** A connection would route, but this deployment holds no license for
   *  federated sign-in (ADR-027's gate, read as method policy). */
  "method_not_licensed",
  /** A connection would route, but its method was never mounted here. */
  "method_not_configured",
  /** An SSO callback matched nobody and the connection forbids provisioning. */
  "jit_disabled",
  /** An SSO callback matched somebody, but not unambiguously enough to link
   *  without a human (ADR-117 §3). */
  "link_proposed",
] as const;
export type SignInRoutingReasonCode =
  (typeof SIGNIN_ROUTING_REASON_CODES)[number];

/**
 * What a method IS, to a screen. `password` and `passkey` are local — the
 * deployment itself authenticates. `federated` is an identity provider, named
 * by the id the sign-in surface dials.
 */
export const SIGNIN_METHOD_KINDS = [
  "password",
  "passkey",
  "federated",
] as const;
export type SignInMethodKind = (typeof SIGNIN_METHOD_KINDS)[number];

export interface SignInMethod {
  /** What the sign-in surface dials: `password`, or the provider id. */
  id: string;
  kind: SignInMethodKind;
  /** The connection this method belongs to; null for instance-level methods
   *  and for the legacy env provider until D04 gives it a connection. */
  connectionId: string | null;
}

export function isLocalSignInMethod(method: SignInMethod): boolean {
  return method.kind !== "federated";
}

/**
 * The connection lifecycle as ROUTING sees it. D04's aggregate carries the
 * full lifecycle (DRAFT → … → TORN_DOWN, ADR-117 §5); routing only ever needs
 * to know whether a connection is serving traffic, has been paused by a human
 * (which the guidance screens name), or is neither.
 */
export const SSO_CONNECTION_ROUTING_STATES = [
  "ACTIVE",
  "SUSPENDED",
  "INACTIVE",
] as const;
export type SsoConnectionRoutingState =
  (typeof SSO_CONNECTION_ROUTING_STATES)[number];

/** A connection as the domain-lookup port answers it. */
export interface RoutableConnection {
  connectionId: string;
  /** The method a redirect to this connection offers. */
  method: SignInMethod;
  state: SsoConnectionRoutingState;
  /** False when this deployment names the connection's method but never
   *  mounted it — a typo in the provider id, or missing credentials. */
  configured: boolean;
  /** Whether an unmatched callback subject may provision a user (ADR-117 §3). */
  allowsJit: boolean;
}

/** Instance-level policy: which methods exist at all, and for whom. */
export interface SignInMethodPolicy {
  /** Offered when nothing routes by domain. */
  defaultMethods: readonly SignInMethod[];
  /** Offered by the break-glass path, and wherever a federated method is
   *  policy-refused. Local by definition — this is the door that must stay
   *  open when the IdP cannot be reached. */
  localMethods: readonly SignInMethod[];
  /** ADR-027's binary license gate, resolved once per process and handed in
   *  frozen. Per-request policy over a frozen gate IS startup semantics. */
  federationLicensed: boolean;
  /** Only a self-hosted deployment auto-redirects on a sole connection; on
   *  cloud, one org's connection must never claim the front door. */
  selfHosted: boolean;
}

/** A submitted identifier, normalized once, with the org-level fact routing
 *  actually uses. */
export interface RoutingIdentifier {
  /** D01's normalization, byte-identical to attach-time. */
  normalized: string;
  /** The domain, or null for a value that is not email-shaped. */
  domain: string | null;
}

/**
 * Normalizes a submitted value exactly as an attach does — one function,
 * imported, never re-implemented (ADR-117 §1). The raw value is deliberately
 * NOT carried forward: nothing downstream of here may route on it.
 */
export function routingIdentifierOf(raw: string): RoutingIdentifier {
  const normalized = normalizeIdentifierValue(raw);
  return { normalized, domain: identifierDomain(normalized) };
}

export const SIGNIN_ROUTING_OUTCOMES = [
  "redirect_to_connection",
  "method_picker",
] as const;
export type SignInRoutingOutcome = (typeof SIGNIN_ROUTING_OUTCOMES)[number];

export interface RoutingDecision {
  outcome: SignInRoutingOutcome;
  /** Present only on `redirect_to_connection`. */
  connectionId?: string;
  /** What the surface offers. On a redirect, the one method it redirects to. */
  methodSet: readonly SignInMethod[];
  reasonCode: SignInRoutingReasonCode;
}

export interface RoutingInput {
  /** Null when the sign-in surface is requested before any address is typed. */
  identifier: RoutingIdentifier | null;
  /** `?local=1`: reach a local sign-in whatever else would have routed. */
  breakGlass: boolean;
  policy: SignInMethodPolicy;
  /** The connection owning the identifier's domain, as the lookup answered.
   *  Null when no connection owns it — which is also the answer for a domain
   *  nobody has ever configured, on purpose. */
  domainConnection: RoutableConnection | null;
  /** Connections this instance could auto-redirect to with no address at all. */
  activeConnections: readonly RoutableConnection[];
}

const picker = (
  methodSet: readonly SignInMethod[],
  reasonCode: SignInRoutingReasonCode,
): RoutingDecision => ({ outcome: "method_picker", methodSet, reasonCode });

/**
 * A connection would route. Policy gets the last word: an unlicensed or
 * unmounted method is not offered anywhere, and the person lands on the local
 * set with a reason code that says which of the two happened. Falling back to
 * `localMethods` rather than `defaultMethods` is deliberate — the defaults are
 * what a licensed deployment offers, and reaching here means they are not.
 */
function redirectOrFall({
  connection,
  policy,
  reasonCode,
}: {
  connection: RoutableConnection;
  policy: SignInMethodPolicy;
  reasonCode: SignInRoutingReasonCode;
}): RoutingDecision {
  if (!policy.federationLicensed) {
    return picker(policy.localMethods, "method_not_licensed");
  }
  if (!connection.configured) {
    return picker(policy.localMethods, "method_not_configured");
  }
  return {
    outcome: "redirect_to_connection",
    connectionId: connection.connectionId,
    methodSet: [connection.method],
    reasonCode,
  };
}

/**
 * The whole router. Read top to bottom, it is ADR-117 §1's table:
 *
 *   break-glass                → local method set     break_glass
 *   no address, sole conn      → redirect             sole_active_connection
 *   domain on a live conn      → redirect             domain_routed
 *   domain on a paused conn    → picker               connection_suspended
 *   anything else              → picker               no_domain_match
 *   policy refuses the method  → picker (local)       method_not_*
 */
export function routeSignIn(input: RoutingInput): RoutingDecision {
  const {
    identifier,
    breakGlass,
    policy,
    domainConnection,
    activeConnections,
  } = input;

  // Checked first, and unconditionally: break-glass exists precisely for the
  // cases below going wrong, so no state they can be in may skip it.
  if (breakGlass) return picker(policy.localMethods, "break_glass");

  if (identifier === null || identifier.domain === null) {
    const sole =
      policy.selfHosted && activeConnections.length === 1
        ? activeConnections[0]
        : undefined;
    if (!sole) return picker(policy.defaultMethods, "no_domain_match");
    return redirectOrFall({
      connection: sole,
      policy,
      reasonCode: "sole_active_connection",
    });
  }

  if (!domainConnection) {
    return picker(policy.defaultMethods, "no_domain_match");
  }
  if (domainConnection.state === "SUSPENDED") {
    return picker(policy.defaultMethods, "connection_suspended");
  }
  if (domainConnection.state !== "ACTIVE") {
    return picker(policy.defaultMethods, "no_domain_match");
  }
  return redirectOrFall({
    connection: domainConnection,
    policy,
    reasonCode: "domain_routed",
  });
}

/**
 * The router's decision, expressed in the one word the LEGACY path answers:
 * `resolveAuthProvider()` returns `"email"` or the id of the IdP the sign-in
 * page auto-redirects to, and that is the entire routing decision the legacy
 * front door makes. Projecting the router onto it is what makes shadow mode a
 * comparison rather than two unrelated logs (ADR-117 §7).
 */
export function legacyProviderOf(decision: RoutingDecision): string {
  if (decision.outcome === "redirect_to_connection") {
    return decision.methodSet[0]?.id ?? "email";
  }
  // A picker that offers anything local is a rendered FORM, which is what the
  // legacy page does in email mode. Only a set of exactly one federated method
  // has a legacy twin: the auto-redirect a single `NEXTAUTH_PROVIDER` gave.
  const only = decision.methodSet[0];
  return decision.methodSet.length === 1 && only && !isLocalSignInMethod(only)
    ? only.id
    : "email";
}

export interface ShadowComparison {
  matches: boolean;
  routerProvider: string;
  legacyProvider: string;
  reasonCode: SignInRoutingReasonCode;
}

/**
 * Shadow mode's whole judgment (ADR-117 §7). Pure, so the thing the bake gate
 * counts is the same function a test can enumerate — and so that computing it
 * can never be what changes a sign-in.
 */
export function compareToLegacy({
  decision,
  legacyProvider,
}: {
  decision: RoutingDecision;
  legacyProvider: string;
}): ShadowComparison {
  const routerProvider = legacyProviderOf(decision);
  return {
    matches: routerProvider === legacyProvider,
    routerProvider,
    legacyProvider,
    reasonCode: decision.reasonCode,
  };
}
