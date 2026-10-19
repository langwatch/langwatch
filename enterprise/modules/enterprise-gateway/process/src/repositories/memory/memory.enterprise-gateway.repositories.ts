// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { EnterpriseGatewayRepositories } from "../routing-policy.repository.ts";
import { MemoryRoutingPolicyRepository } from "./memory.routing-policy.repository.ts";

/** The "memory" tier: every Enterprise gateway repository, with no database behind it. */
export class MemoryEnterpriseGatewayRepositories {
  static readonly requires = [] as const;

  static create(): EnterpriseGatewayRepositories {
    return { routingPolicies: MemoryRoutingPolicyRepository.create() };
  }
}
