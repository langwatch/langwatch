import type {
  CreateRoutingPolicyInput,
  DeleteRoutingPolicyInput,
  ListRoutingPoliciesInput,
  ResolveDefaultRoutingPolicyInput,
  RoutingPolicy,
  SetDefaultRoutingPolicyInput,
  UpdateRoutingPolicyInput,
} from "@langwatch/enterprise-governance-contract";

export abstract class RoutingPolicyRepository {
  abstract list(input: ListRoutingPoliciesInput): Promise<RoutingPolicy[]>;
  abstract tryFindById(id: string): Promise<RoutingPolicy | null>;
  abstract countReachableModelProviders(input: {
    organizationId: string;
    modelProviderIds: string[];
  }): Promise<number>;
  abstract create(input: CreateRoutingPolicyInput): Promise<RoutingPolicy>;
  abstract update(input: UpdateRoutingPolicyInput): Promise<RoutingPolicy>;
  abstract setDefault(
    input: SetDefaultRoutingPolicyInput,
  ): Promise<RoutingPolicy>;
  abstract delete(input: DeleteRoutingPolicyInput): Promise<void>;
  abstract tryResolveDefaultForUser(
    input: ResolveDefaultRoutingPolicyInput,
  ): Promise<RoutingPolicy | null>;
}
