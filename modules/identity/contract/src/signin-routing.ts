import { z } from "zod";

import { extractIdentifierDomain, normalizeIdentifierValue } from "./identifier.ts";

/**
 * The identifier-first sign-in router (D03, ADR-117 §1): a PURE decision engine — email in,
 * decision out, no Prisma/env/framework/clock. It also sees account existence and method
 * kinds now; see ADR-117's "Revision (2026-08-25)" for why that no longer breaks the no-oracle.
 */

/**
 * The reason vocabulary. Codes are VOCABULARY, not copy — customer-facing words live in the
 * app's presentation registry keyed by error code; screens (D13) key guidance states off these.
 * A screen needing new behavior needs a new reason code first (ADR-117 §6).
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
export type SignInRoutingReasonCode = (typeof SIGNIN_ROUTING_REASON_CODES)[number];

/**
 * What a method IS, to a screen. `password` and `passkey` are local — the
 * deployment itself authenticates. `federated` is an identity provider, named
 * by the id the sign-in surface dials.
 */
export const SIGNIN_METHOD_KINDS = ["password", "passkey", "federated"] as const;
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
 * The connection lifecycle as ROUTING sees it — not D04's full aggregate
 * lifecycle (ADR-117 §5), only whether a connection serves traffic, was
 * paused by a human, or is neither.
 */
export const SSO_CONNECTION_ROUTING_STATES = ["ACTIVE", "SUSPENDED", "INACTIVE"] as const;
export type SsoConnectionRoutingState = (typeof SSO_CONNECTION_ROUTING_STATES)[number];

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
  return { normalized, domain: extractIdentifierDomain(normalized) };
}

export const SIGNIN_ROUTING_OUTCOMES = [
  "redirect_to_connection",
  "method_picker",
  /**
   * Nobody holds this address, so the journey is a sign-up. Its own outcome,
   * not an empty-method picker: the screen asks for a confirmation link.
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
  /** True when an ACTIVE organization connection fell back to local methods. */
  domainManaged?: true;
}

/** One offered method, as a transport states it. @see SignInMethod */
export const signInMethodSchema = z.object({
  id: z.string(),
  kind: z.enum(SIGNIN_METHOD_KINDS),
  connectionId: z.string().nullable(),
});

/**
 * The decision the front door answers with. The object IS the contract: a
 * screen renders `methodSet` and keys its guidance off `reasonCode`.
 */
export const routingDecisionSchema = z.object({
  outcome: z.enum(SIGNIN_ROUTING_OUTCOMES),
  connectionId: z.string().optional(),
  methodSet: z.array(signInMethodSchema).readonly(),
  reasonCode: z.enum(SIGNIN_ROUTING_REASON_CODES),
  domainManaged: z.literal(true).optional(),
});

/**
 * What the identified account holds, as the account lookup answers it. Kinds,
 * never material — "can sign in with a passkey", never which one or when.
 */
export interface AccountSignInMethods {
  hasPassword: boolean;
  hasPasskey: boolean;
  /** Legacy instance provider ids this account holds, such as auth0 or okta. */
  providerIds: readonly string[];
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
   * What the submitted address's account holds, or null when no account holds it.
   * `undefined` means the question was not asked (break-glass, or a domain that already
   * routed) — distinct from null, since "no account" must never be mistaken for "not asked".
   */
  account?: AccountSignInMethods | null;
}

/**
 * The account's own methods, strongest first (passkey, then federated, then password — a
 * security claim, not a preference: a passkey resists phishing/replay, a password can be
 * talked out of someone by phone), intersected with policy so a retired method is dropped.
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
    return method.connectionId === null
      ? account.providerIds.includes(method.id)
      : account.connectionIds.includes(method.connectionId);
  };

  const rankOf = (method: SignInMethod): number => {
    if (method.kind === "passkey") return 0;
    if (method.kind === "federated") return 1;
    return 2;
  };

  return offered
    .filter(held)
    .slice()
    .toSorted((a, b) => rankOf(a) - rankOf(b));
}

const picker = (
  methodSet: readonly SignInMethod[],
  reasonCode: SignInRoutingReasonCode,
): RoutingDecision => ({ outcome: "method_picker", methodSet, reasonCode });

/**
 * A connection would route, but policy gets the last word: an unlicensed or
 * unmounted method falls back to `localMethods`, not `defaultMethods` — the
 * defaults are what a licensed deployment offers, and this is not that.
 */
function redirectOrFall({
  connection,
  policy,
  reasonCode,
  domainManaged = false,
}: {
  connection: RoutableConnection;
  policy: SignInMethodPolicy;
  reasonCode: SignInRoutingReasonCode;
  /** The fall still says the domain is managed: the organization routes this
   *  address even where this deployment cannot serve its method today. */
  domainManaged?: boolean;
}): RoutingDecision {
  if (!policy.federationLicensed) {
    const fallback = picker(policy.localMethods, "method_not_licensed");
    return domainManaged ? { ...fallback, domainManaged: true } : fallback;
  }
  if (!connection.configured) {
    const fallback = picker(policy.localMethods, "method_not_configured");
    return domainManaged ? { ...fallback, domainManaged: true } : fallback;
  }
  return {
    outcome: "redirect_to_connection",
    connectionId: connection.connectionId,
    methodSet: [connection.method],
    reasonCode,
  };
}

/**
 * Nothing to route on. A self-hosted instance running exactly ONE active
 * connection is the exception: there is no other connection the address could
 * have meant, so it routes anyway.
 */
function routeWithoutDomain({
  policy,
  activeConnections,
}: {
  policy: SignInMethodPolicy;
  activeConnections: readonly RoutableConnection[];
}): RoutingDecision {
  const sole =
    policy.selfHosted && activeConnections.length === 1 ? activeConnections[0] : undefined;
  if (!sole) return picker(policy.defaultMethods, "no_domain_match");

  return redirectOrFall({ connection: sole, policy, reasonCode: "sole_active_connection" });
}

/**
 * Whether this decision hands the address to an ORGANIZATION's own connection
 * (D04). An instance-level redirect carries no connection and is not somebody's
 * company saying how its people sign in.
 */
export function routesToOrganizationConnection(decision: RoutingDecision): boolean {
  return (
    decision.outcome === "redirect_to_connection" &&
    decision.methodSet.some((method) => method.connectionId !== null)
  );
}

/**
 * The whole router: read top to bottom, this is ADR-117's decision table (2026-08-25 revision).
 * The account branches sit BELOW domain routing — load-bearing, since a just-in-time-provisioned
 * hire's domain must redirect to their identity provider before any account lookup happens.
 */

export function routeSignIn(input: RoutingInput): RoutingDecision {
  const { identifier, breakGlass, policy, domainConnection, activeConnections, account } = input;

  // Checked first, and unconditionally: break-glass exists precisely for the
  // cases below going wrong, so no state they can be in may skip it.
  if (breakGlass) return picker(policy.localMethods, "break_glass");

  if (identifier === null || identifier.domain === null) {
    return routeWithoutDomain({ policy, activeConnections });
  }

  if (domainConnection?.state === "SUSPENDED") {
    return picker(policy.defaultMethods, "connection_suspended");
  }
  if (domainConnection?.state === "ACTIVE") {
    return redirectOrFall({
      connection: domainConnection,
      policy,
      reasonCode: "domain_routed",
      domainManaged: true,
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

  // One federated method and nothing else is already a routing answer: a
  // picker with a single button costs a click and says nothing the person did
  // not just type. Only federated, and only an INSTANCE-LEVEL one - a
  // connection carries a lifecycle this branch cannot see (SUSPENDED,
  // unconfigured) and every other redirect to one passes those gates.
  const sole = held.length === 1 ? held[0] : undefined;
  if (sole?.kind === "federated" && sole.connectionId === null) {
    return {
      outcome: "redirect_to_connection",
      methodSet: [sole],
      reasonCode: "account_methods",
    };
  }

  return picker(held, "account_methods");
}

/** Whether routing established that an organization's domain owns this address. */
export function isOrganizationManagedDecision(decision: RoutingDecision): boolean {
  return (
    decision.reasonCode === "domain_routed" ||
    decision.reasonCode === "connection_suspended" ||
    decision.domainManaged === true
  );
}

/**
 * The router's decision, expressed as the LEGACY path does:
 * `resolveAuthProvider()` returns `"email"` or an IdP id. Projecting onto it
 * is what makes shadow mode a comparison, not two unrelated logs (ADR-117 §7).
 */
export function legacyProviderOf(decision: RoutingDecision): string {
  if (decision.outcome === "redirect_to_connection") {
    return decision.methodSet[0]?.id ?? "email";
  }
  // A picker that offers anything local is a rendered FORM, which is what the
  // legacy page does in email mode. Only a set of exactly one federated method
  // has a legacy twin: the auto-redirect a single `NEXTAUTH_PROVIDER` gave.
  const only = decision.methodSet[0];
  return decision.methodSet.length === 1 && only && !isLocalSignInMethod(only) ? only.id : "email";
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
