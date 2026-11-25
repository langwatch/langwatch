import type { SignUpEnrollment } from "@langwatch/auth-contract";
import {
  isOrganizationManagedDecision,
  type RoutingDecision,
  type SignInMethod,
  type SignInRoutingReasonCode,
} from "@langwatch/identity-contract";

/** Whether routing alone answers, before any account is looked up: an organization's address. */
export function isSettledByRouting(decision: RoutingDecision): boolean {
  return decision.outcome === "redirect_to_connection" || isOrganizationManagedDecision(decision);
}

/** Which methods this address may enrol: main's `decideLocalSignUp` over facts already read. */
export function decideLocalSignUp({
  decision,
  addressIsTaken,
  defaultMethods,
  passwordIsAllowed,
}: {
  decision: RoutingDecision;
  addressIsTaken: boolean;
  defaultMethods: readonly SignInMethod[];
  passwordIsAllowed: boolean;
}): SignUpEnrollment {
  if (decision.outcome === "redirect_to_connection") {
    return { outcome: "redirect", methodSet: decision.methodSet, reasonCode: decision.reasonCode };
  }
  if (isOrganizationManagedDecision(decision)) return unavailable(decision.reasonCode);
  if (addressIsTaken) {
    return { outcome: "existing_account", methodSet: [], reasonCode: "account_methods" };
  }

  const offered = offeredMethods({ decision, defaultMethods });
  const methodSet = passwordIsAllowed
    ? offered
    : offered.filter((method) => method.kind !== "password");
  if (methodSet.length === 0) return unavailable(decision.reasonCode);

  return { outcome: "enroll", methodSet, reasonCode: decision.reasonCode };
}

function offeredMethods({
  decision,
  defaultMethods,
}: {
  decision: RoutingDecision;
  defaultMethods: readonly SignInMethod[];
}): readonly SignInMethod[] {
  if (decision.outcome === "route_to_signup") return defaultMethods;
  if (
    decision.reasonCode === "method_not_licensed" ||
    decision.reasonCode === "method_not_configured"
  ) {
    return decision.methodSet;
  }

  return [];
}

function unavailable(reasonCode: SignInRoutingReasonCode): SignUpEnrollment {
  return { outcome: "unavailable", methodSet: [], reasonCode };
}
