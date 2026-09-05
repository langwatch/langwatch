import type { ModelProvider } from "@langwatch/prisma-client/generated";
import type { GatewayPersistenceTransaction } from "../ports/gateway-change-events.port";

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
  abstract findRoutingPolicyOrder(input: {
    routingPolicyId: string;
    transaction?: GatewayPersistenceTransaction;
  }): Promise<GatewayRoutingPolicyOrder | null>;
}
