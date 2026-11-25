// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The signals whose Customer.io calls are each claimed on their own, so a retry after one call
 * went sends only the rest: gateway's key facts and governance's source facts.
 */
import type { CioBatchCall, NurturingSignal } from "@langwatch/enterprise-nurturing-contract";

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

export type ClaimedSignal = GatewayKeySignal | GovernanceSourceSignal;

/** Whether each of the signal's Customer.io calls is claimed on its own. */
export function isClaimedSignal(signal: NurturingSignal): signal is ClaimedSignal {
  return isGatewayKeySignal(signal) || isGovernanceSourceSignal(signal);
}

/** The calls a claimed signal makes, in the order they are sent. */
export function fireClaimedSignal(signal: ClaimedSignal): CioBatchCall[] {
  if (isGovernanceSourceSignal(signal)) return fireGovernanceSourceSignal(signal);
  return fireGatewayKeySignal(signal);
}
