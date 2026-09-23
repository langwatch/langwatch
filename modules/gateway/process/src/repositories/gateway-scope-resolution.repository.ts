import type { ModelProvider } from "@langwatch/gateway-contract";

import type { GatewayPersistenceTransaction } from "../app/gateway.members.ts";

/** A model provider row a virtual key may reach. */
export type EligibleModelProvider = ModelProvider;

/** The dispatch order a routing policy states, and the organization it belongs to. */
export type GatewayRoutingPolicyOrder = {
  modelProviderIds: unknown;
  organizationId: string;
};

/**
 * The rows behind "which providers does this key reach": the scope graph the
 * key hangs off, and the policy that orders what it dispatches to.
 */
export abstract class GatewayScopeResolutionRepository {
  /**
   * The team each named project belongs to, so a key scoped at PROJECT:P
   * inherits TEAM:P.teamId visibility on providers.
   */
  abstract findTeamIdsForProjects(input: {
    projectIds: string[];
    transaction?: GatewayPersistenceTransaction;
  }): Promise<string[]>;
  /**
   * Every live provider reachable from any of these scopes. Soft-deleted and
   * disabled rows are excluded here, so a credential an admin pulled never
   * reaches the dispatcher.
   */
  abstract findProvidersReachableFromScopes(input: {
    organizationIds: string[];
    teamIds: string[];
    projectIds: string[];
    transaction?: GatewayPersistenceTransaction;
  }): Promise<EligibleModelProvider[]>;
  /**
   * The platform services a CONNECT key may serve, as stored on the key; empty
   * for any other key, a key of another organization, or one never granted any.
   */
  abstract findManagedKeyConnectServices(input: {
    virtualKeyId: string;
    organizationId: string;
    transaction?: GatewayPersistenceTransaction;
  }): Promise<string[]>;
  abstract findRoutingPolicyOrder(input: {
    routingPolicyId: string;
    transaction?: GatewayPersistenceTransaction;
  }): Promise<GatewayRoutingPolicyOrder | null>;
}
