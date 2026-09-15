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
  abstract findById(id: string): Promise<RoutingPolicy | null>;
  abstract countReachableModelProviders(input: {
    organizationId: string;
    modelProviderIds: string[];
  }): Promise<number>;
  abstract create(input: CreateRoutingPolicyInput): Promise<RoutingPolicy>;
  abstract update(input: UpdateRoutingPolicyInput): Promise<RoutingPolicy>;
  abstract setDefault(input: SetDefaultRoutingPolicyInput): Promise<RoutingPolicy>;
  abstract delete(input: DeleteRoutingPolicyInput): Promise<void>;
  abstract findDefaultForUser(
    input: ResolveDefaultRoutingPolicyInput,
  ): Promise<RoutingPolicy | null>;
}
