/**
 * Resolves the eligible model-provider set and order for a virtual key in two passes: eligibility
 * takes every provider reachable through the upward scope cascade, skipping disabled and
 * soft-deleted rows, and ordering follows the routing policy or else fallback priority.
 */
import { isDispatchableProvider } from "@langwatch/model-provider-contract";
import type { GatewayPersistenceTransaction } from "../ports/gateway-change-events.port";
import { type VirtualKeyWithScopes } from "../ports/gateway-virtual-key.port";
import type {
  EligibleModelProvider,
  GatewayScopeResolutionRepository,
} from "../repositories/gateway-scope-resolution.repository";

/**
 * Which model providers a virtual key reaches, and in which dispatch order.
 */
export class GatewayScopeResolutionService {
  private constructor(private readonly repository: GatewayScopeResolutionRepository) {}

  static create(input: {
    repository: GatewayScopeResolutionRepository;
  }): GatewayScopeResolutionService {
    return new GatewayScopeResolutionService(input.repository);
  }

  /**
   * Providers a key reaches through its scope graph alone, intersected with routable rows and with
   * the routing policy not applied. This is the set an allowlist may name and the drawer offers: a
   * policy narrows what the gateway dispatches to, never what the allowlist may hold.
   */
  async scopeReachableModelProvidersForVk(
    vk: VirtualKeyWithScopes,
    transaction?: GatewayPersistenceTransaction,
  ): Promise<EligibleModelProvider[]> {
    const scopes = await this.reachableScopes(vk, transaction);
    const reachable = await this.repository.findProvidersReachableFromScopes({
      ...scopes,
      transaction,
    });

    return reachable.filter((mp) => isDispatchableProvider(mp.provider));
  }

  /**
   * Providers a key dispatches to, in order: the scope-reachable set intersected with the policy's
   * providers and reordered when a routing policy is set. The config materialiser builds the flat
   * provider chain from it; allowlist validation uses the scope-reachable set instead.
   */
  async eligibleModelProvidersForVk(
    vk: VirtualKeyWithScopes,
    transaction?: GatewayPersistenceTransaction,
  ): Promise<EligibleModelProvider[]> {
    const candidates = await this.scopeReachableModelProvidersForVk(vk, transaction);
    if (candidates.length === 0) {
      return [];
    }

    if (vk.routingPolicyId) {
      const policy = await this.repository.tryFindRoutingPolicyOrder({
        routingPolicyId: vk.routingPolicyId,
        transaction,
      });
      if (!policy || policy.organizationId !== vk.organizationId) {
        return [];
      }

      const orderedIds = parseModelProviderIds(policy.modelProviderIds);
      if (orderedIds.length === 0) {
        return [];
      }

      const byId = new Map(candidates.map((mp) => [mp.id, mp]));

      return orderedIds
        .map((id) => byId.get(id))
        .filter((mp): mp is EligibleModelProvider => Boolean(mp));
    }

    return candidates.sort(deterministicMpOrder);
  }

  /**
   * The organization, team and project ids a key's scope entries reach. A
   * PROJECT scope also reaches its own team, so a provider shared with the
   * team is visible to a key scoped only at the project.
   */
  private async reachableScopes(
    vk: VirtualKeyWithScopes,
    transaction?: GatewayPersistenceTransaction,
  ): Promise<{ organizationIds: string[]; teamIds: string[]; projectIds: string[] }> {
    const organizationIds = new Set<string>([vk.organizationId]);
    const teamIds = new Set<string>();
    const projectIds = new Set<string>();

    for (const entry of vk.scopes) {
      switch (entry.scopeType) {
        case "ORGANIZATION":
          organizationIds.add(entry.scopeId);
          break;
        case "TEAM":
          teamIds.add(entry.scopeId);
          break;
        case "PROJECT":
          projectIds.add(entry.scopeId);
          break;
      }
    }

    if (projectIds.size > 0) {
      const inheritedTeamIds = await this.repository.findTeamIdsForProjects({
        projectIds: [...projectIds],
        transaction,
      });
      for (const teamId of inheritedTeamIds) {
        teamIds.add(teamId);
      }
    }

    return {
      organizationIds: [...organizationIds],
      teamIds: [...teamIds],
      projectIds: [...projectIds],
    };
  }
}

function deterministicMpOrder(a: EligibleModelProvider, b: EligibleModelProvider): number {
  const pa = a.fallbackPriorityGlobal;
  const pb = b.fallbackPriorityGlobal;
  if (pa !== null && pb !== null && pa !== pb) {
    return pa - pb;
  }

  if (pa !== null && pb === null) {
    return -1;
  }

  if (pa === null && pb !== null) {
    return 1;
  }

  return a.createdAt.getTime() - b.createdAt.getTime();
}

function parseModelProviderIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.filter((v): v is string => typeof v === "string" && v.length > 0);
}
