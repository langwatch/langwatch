// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The signals whose Customer.io calls are each claimed on their own, so a retry after one call
 * went sends only the rest: gateway's key facts, governance's source facts and the onboarding
 * variant assignment, which no later backfill recovers for an organization that picks no path.
 */
import type {
  CioBatchCall,
  NurturingSignal,
  NurturingSignalOf,
} from "@langwatch/enterprise-nurturing-contract";

import {
  fireGatewayKeySignal,
  type GatewayKeySignal,
  isGatewayKeySignal,
} from "./nurturing-gateway-facts.rules.ts";
import {
  fireGovernanceSourceSignal,
  type GovernanceSourceSignal,
  isGovernanceSourceSignal,
} from "./nurturing-governance-facts.rules.ts";
import { fireOnboardingVariantAssigned } from "./nurturing-guided-onboarding-service.rules.ts";

export type ClaimedSignal =
  | GatewayKeySignal
  | GovernanceSourceSignal
  | NurturingSignalOf<"onboarding_variant_assigned">;

/** Whether each of the signal's Customer.io calls is claimed on its own. */
export function isClaimedSignal(signal: NurturingSignal): signal is ClaimedSignal {
  return (
    isGatewayKeySignal(signal) ||
    isGovernanceSourceSignal(signal) ||
    signal.kind === "onboarding_variant_assigned"
  );
}

/** The calls a claimed signal makes, in the order they are sent. */
export function fireClaimedSignal(signal: ClaimedSignal): CioBatchCall[] {
  if (signal.kind === "onboarding_variant_assigned") return fireOnboardingVariantAssigned(signal);
  if (isGovernanceSourceSignal(signal)) return fireGovernanceSourceSignal(signal);
  return fireGatewayKeySignal(signal);
}
