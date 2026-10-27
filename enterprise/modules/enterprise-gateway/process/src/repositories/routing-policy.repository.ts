// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type {
  CreateRoutingPolicyInput,
  DeleteRoutingPolicyInput,
  ListRoutingPoliciesInput,
  ResolveDefaultRoutingPolicyInput,
  RoutingPolicy,
  SetDefaultRoutingPolicyInput,
  UpdateRoutingPolicyInput,
} from "@langwatch/enterprise-gateway-contract";

export abstract class RoutingPolicyRepository {
  /** `projectTeamId`: the team of a PROJECT `selectableForScope`, whose policies also count. */
  abstract findAll(
    input: ListRoutingPoliciesInput & { projectTeamId?: string | undefined },
  ): Promise<RoutingPolicy[]>;
  abstract count(input: { organizationId: string }): Promise<number>;
  abstract findById(id: string): Promise<RoutingPolicy | null>;
  abstract create(input: CreateRoutingPolicyInput): Promise<RoutingPolicy>;
  abstract update(input: UpdateRoutingPolicyInput): Promise<RoutingPolicy>;
  abstract setDefault(input: SetDefaultRoutingPolicyInput): Promise<RoutingPolicy>;
  abstract delete(input: DeleteRoutingPolicyInput): Promise<void>;
  abstract findDefaultForUser(
    input: ResolveDefaultRoutingPolicyInput,
  ): Promise<RoutingPolicy | null>;
}

export type EnterpriseGatewayRepositories = Readonly<{ routingPolicies: RoutingPolicyRepository }>;
