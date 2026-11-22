// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  RoutingPolicyModelMustBeConcreteError,
  RoutingPolicyModelNotConcreteError,
  RoutingPolicyMustHaveProviderError,
  RoutingPolicyMustHaveScopeError,
  RoutingPolicyProviderOutOfScopeError,
  RoutingPolicyProviderRequiredError,
  RoutingPolicyProviderScopeError,
  RoutingPolicyScopeRequiredError,
} from "@langwatch/enterprise-gateway-contract";

/** The routing-policy guards as handled errors; anything else stays unknown (ADR-045). */
export function asHandledRoutingPolicyError(error: unknown): unknown {
  if (error instanceof RoutingPolicyMustHaveProviderError) {
    return new RoutingPolicyProviderRequiredError();
  }
  if (error instanceof RoutingPolicyMustHaveScopeError) {
    return new RoutingPolicyScopeRequiredError();
  }
  if (error instanceof RoutingPolicyModelMustBeConcreteError) {
    return new RoutingPolicyModelNotConcreteError(error.field, error.value);
  }
  if (error instanceof RoutingPolicyProviderScopeError) {
    return new RoutingPolicyProviderOutOfScopeError();
  }
  return error;
}
