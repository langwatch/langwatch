import { identifierDomain, normalizeIdentifierValue } from "./identifier";

/**
 * The identifier-first sign-in router (D03, ADR-117 §1): a PURE decision
 * engine. Email in, decision out — no Prisma, no env, no framework, no clock.
 *
 * Everything the engine needs is assembled by a composition layer from
 * injected ports: an org-level domain lookup, an instance-level method
 * policy, and — since the 2026-08-25 revision — what the identified account
 * holds.
 *
 * ── Why this engine now sees an account, when it was built not to ────────
 *
 * It was built existence-blind on purpose, so that ADR-117 §2's no-oracle
 * held by construction rather than by care. That constraint is retired, and
 * the ADR revision carries the argument in full; the short version is that
 * the sign-up door already answers "does this address have an account" to
 * anybody who asks (`EMAIL_ALREADY_REGISTERED`, Q12), so spending the
 * router's architecture hiding the same fact bought nothing except a worse
 * sign-in for the people who do have accounts — a password box in front of a
 * passkey-only account, and a password box in front of no account at all.
 *
 * What the engine sees is deliberately the thinnest thing that answers the
 * two questions the screen has: does an account exist, and what KINDS of
 * method does it hold. It reads no credential, no hash, no passkey material
 * and no session, and it is still pure — the lookup happens in the
 * composition layer, and its answer arrives as a value.
 *
 * What did NOT change, and must not: a credential refusal is still one
 * refusal (`identity_sign_in_refused` covers a wrong password and an unknown
 * address alike), and the identifier lookup is still rate-limited at its
 * entry point, so enumeration stays expensive in bulk even though any single
 * answer is now cheap.
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
  /** Nothing routes the domain, and the instance's default methods are the
   *  answer: no address was submitted, or the account's own methods came back
   *  empty because policy offers none of them. */
  "no_domain_match",
  /** No account exists for the submitted address. The screen carries on as a
   *  sign-up rather than asking for a credential nobody holds. */
  "identifier_unknown",
  /** An account exists, and the methods offered are the ones IT holds. */
  "account_methods",
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
   *  cloud, one org's connection must never claim the auth screens. */
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
  /**
   * Nobody holds this address, so the journey is a sign-up. Its own outcome
   * rather than a picker with an empty method set: the screen that answers it
   * asks for a confirmation link, not for a credential, and a caller reading
   * `methodSet` to decide what to draw would draw nothing.
   */
  "route_to_signup",
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

/**
 * What the identified account holds, as the account lookup answers it.
 *
 * Kinds, never material. "This account can sign in with a passkey" is what
 * the screen needs to know to offer one; which passkey, on which device,
 * registered when, is not, and the engine is the wrong place for any of it.
 */
export interface AccountSignInMethods {
  hasPassword: boolean;
  hasPasskey: boolean;
  /** Connections this account already signs in through, by connection id. */
  connectionIds: readonly string[];
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
  /**
   * What the submitted address's account holds, or null when no account holds
   * the address at all.
   *
   * `undefined` means the question was not asked — no address was submitted,
   * or the composition layer skipped the lookup because the decision was
   * already made without it (break-glass, and a domain that routes). The three
   * states are distinct on purpose: "no account" is a routing answer, and "not
   * asked" must never be mistaken for it.
   */
  account?: AccountSignInMethods | null;
}

/**
 * The account's own methods, strongest first, and only the ones this
 * deployment actually offers.
 *
 * Strongest-first is passkey, then a federated connection, then password, and
 * the order is a security claim rather than a preference: a passkey cannot be
 * phished or replayed, a federated sign-in inherits whatever the organization
 * enforces centrally, and a password is the one a person can be talked out of
 * over the telephone.
 *
 * The intersection with policy is what stops the account's history overruling
 * the instance's rules: somebody who once set a password on a deployment that
 * has since turned passwords off is not offered one, because it would not
 * work.
 */
export function rankAccountMethods({
  account,
  policy,
}: {
  account: AccountSignInMethods;
  policy: SignInMethodPolicy;
}): readonly SignInMethod[] {
  const offered = policy.defaultMethods;
  const held = (method: SignInMethod): boolean => {
    if (method.kind === "passkey") return account.hasPasskey;
    if (method.kind === "password") return account.hasPassword;
    return (
      method.connectionId !== null &&
      account.connectionIds.includes(method.connectionId)
    );
  };

  const rankOf = (method: SignInMethod): number => {
    if (method.kind === "passkey") return 0;
    if (method.kind === "federated") return 1;
    return 2;
  };

  return offered
    .filter(held)
    .slice()
    .sort((a, b) => rankOf(a) - rankOf(b));
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
 * The whole router. Read top to bottom, it is ADR-117 §1's table, as amended
 * by the 2026-08-25 revision:
 *
 *   break-glass                → local method set     break_glass
 *   no address, sole conn      → redirect             sole_active_connection
 *   domain on a live conn      → redirect             domain_routed
 *   domain on a paused conn    → picker               connection_suspended
 *   no account for the address → sign-up              identifier_unknown
 *   account, methods it holds  → picker               account_methods
 *   anything else              → picker               no_domain_match
 *   policy refuses the method  → picker (local)       method_not_*
 *
 * The account branches sit BELOW domain routing, and that ordering is load
 * bearing: an address on a connected domain redirects to its identity
 * provider whether or not an account exists here yet, because just-in-time
 * provisioning is exactly the case where it does not. Asking "do we know
 * this person" before "does their organization own this domain" would send
 * every genuine new hire to a sign-up form instead of to their employer.
 */
export function routeSignIn(input: RoutingInput): RoutingDecision {
  const {
    identifier,
    breakGlass,
    policy,
    domainConnection,
    activeConnections,
    account,
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

  if (domainConnection?.state === "SUSPENDED") {
    return picker(policy.defaultMethods, "connection_suspended");
  }
  if (domainConnection?.state === "ACTIVE") {
    return redirectOrFall({
      connection: domainConnection,
      policy,
      reasonCode: "domain_routed",
    });
  }

  // Nothing routes the domain, so the account is the next question — when it
  // was asked at all. A composition layer that did not ask keeps the old
  // answer, which is what makes this revision additive: an instance that never
  // wires the lookup behaves exactly as it did before.
  if (account === undefined) {
    return picker(policy.defaultMethods, "no_domain_match");
  }

  if (account === null) {
    return {
      outcome: "route_to_signup",
      // Empty, and it has to be: there is no account, so there is no method it
      // holds, and offering the instance's defaults here is the dead end this
      // outcome exists to remove.
      methodSet: [],
      reasonCode: "identifier_unknown",
    };
  }

  const held = rankAccountMethods({ account, policy });
  // An account whose every method this deployment has since turned off. Not a
  // sign-up — the account is real and somebody may yet re-enable the method —
  // so it falls back to the uniform picker it would have got before, which at
  // least offers the ways in that do work.
  if (held.length === 0) {
    return picker(policy.defaultMethods, "no_domain_match");
  }
  return picker(held, "account_methods");
}

/**
 * The router's decision, expressed in the one word the LEGACY path answers:
 * `resolveAuthProvider()` returns `"email"` or the id of the IdP the sign-in
 * page auto-redirects to, and that is the entire routing decision the legacy
 * auth screens makes. Projecting the router onto it is what makes shadow mode a
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
