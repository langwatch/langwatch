import {
  GatewayScopeResolutionRepository,
  type EligibleModelProvider,
  type GatewayRoutingPolicyOrder,
} from "../gateway-scope-resolution.repository.ts";
import type { MemoryGatewayStore } from "./memory.gateway.store.ts";

/** The providers a key reaches through its scopes, over the seeded provider and policy rows. */
export class MemoryGatewayScopeResolutionRepository extends GatewayScopeResolutionRepository {
  static create(store: MemoryGatewayStore): MemoryGatewayScopeResolutionRepository {
    return new MemoryGatewayScopeResolutionRepository(store);
  }

  private constructor(private readonly store: MemoryGatewayStore) {
    super();
  }

  async findProvidersReachableFromScopes(input: {
    organizationIds: string[];
    teamIds: string[];
    projectIds: string[];
  }): Promise<EligibleModelProvider[]> {
    const reachable = {
      ORGANIZATION: new Set(input.organizationIds),
      TEAM: new Set(input.teamIds),
      PROJECT: new Set(input.projectIds),
    };

    return this.store.modelProviders
      .filter(
        (provider) =>
          provider.enabled &&
          provider.disabledAt === null &&
          provider.scopes.some((scope) => reachable[scope.scopeType].has(scope.scopeId)),
      )
      .map(({ scopes: _scopes, ...provider }) => provider);
  }

  async findManagedKeyConnectServices(input: {
    virtualKeyId: string;
    organizationId: string;
  }): Promise<string[]> {
    const key = this.store.virtualKeys.get(input.virtualKeyId);
    if (key?.organizationId !== input.organizationId || key.purpose !== "CONNECT") return [];

    return [...(this.store.connectColumns.get(key.id)?.connectServices ?? [])];
  }

  async findRoutingPolicyOrder(input: {
    routingPolicyId: string;
  }): Promise<GatewayRoutingPolicyOrder | null> {
    const policy = this.store.routingPolicies.find((row) => row.id === input.routingPolicyId);
    return policy
      ? { modelProviderIds: policy.modelProviderIds, organizationId: policy.organizationId }
      : null;
  }
}
