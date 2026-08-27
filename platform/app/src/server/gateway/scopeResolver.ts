/**
 * Resolve the eligible-ModelProvider set + order for a VirtualKey.
 *
 * Two passes:
 *
 *   1. Eligibility — collect every ModelProvider reachable from the VK's
 *      `VirtualKeyScope` entries via the upward cascade
 *      PROJECT -> TEAM -> ORGANIZATION. A VK at PROJECT:P sees MPs scoped
 *      at PROJECT:P, TEAM:P.teamId, or ORGANIZATION:vk.organizationId.
 *      A VK at TEAM:T sees ORG + TEAM:T MPs. A VK at ORGANIZATION sees
 *      ORG MPs only. Mirrors `findAllAccessibleForProject` on
 *      ModelProviderRepository (same predicate shape, same tenancy
 *      assumptions). Disabled MPs and soft-deleted MPs (disabledAt set)
 *      are skipped so the gateway dispatcher never sees a credential
 *      pulled by an admin.
 *
 *   2. Ordering — when `routingPolicyId` is set, the policy's
 *      `modelProviderIds` array dictates ordering; entries that aren't
 *      eligible (e.g. an MP whose scope no longer overlaps the VK) are
 *      filtered out. When no policy, fall back to
 *      `fallbackPriorityGlobal` ASC then `createdAt` ASC, both
 *      deterministic.
 *
 * Used by the gateway-config materialiser to assemble the flat
 * `providers[]` array the Go dispatcher reads on every request.
 *
 */
import type { ModelProvider, Prisma, PrismaClient } from "~/generated/prisma/client";
import { isDispatchableProvider } from "@langwatch/model-provider-contract";
import type { ScopeInput, VirtualKeyWithScopes } from "@langwatch/gateway-server";

export type EligibleModelProvider = ModelProvider;

/**
 * The providers a VK reaches through its scope graph alone: scope cascade
 * (pass 1) intersected with routable rows (enabled, not withdrawn, registry
 * dispatchable). The routing policy is NOT applied here.
 *
 * This is the set a key's provider allowlist may name, and the set the drawer
 * offers. A routing policy narrows what the gateway DISPATCHES to, never what
 * the allowlist may hold: a provider the scope reaches but the policy omits is
 * still savable, and the policy blocks it at dispatch (see
 * `eligibleModelProvidersForVk` + `config.materialiser`), not at save.
 */
export async function scopeReachableModelProvidersForVk(
  prisma: PrismaClient,
  vk: VirtualKeyWithScopes,
  tx?: Prisma.TransactionClient,
): Promise<EligibleModelProvider[]> {
  const client = tx ?? prisma;

  const scopePredicates = await buildScopePredicates(client, vk);
  if (scopePredicates.length === 0) return [];

  return (
    await client.modelProvider.findMany({
      where: {
        enabled: true,
        disabledAt: null,
        scopes: { some: { OR: scopePredicates } },
      },
    })
  ).filter((mp) => isDispatchableProvider(mp.provider));
}

/**
 * The providers a VK DISPATCHES to, in dispatch order. Scope-reachable set
 * (above) then, when the VK carries a `routingPolicyId`, intersected with the
 * policy's `modelProviderIds` and returned in policy order. Used by the
 * gateway-config materialiser to build the flat `providers[]` chain. For the
 * allowlist-validation and UI-parity set, use `scopeReachableModelProvidersForVk`.
 */
export async function eligibleModelProvidersForVk(
  prisma: PrismaClient,
  vk: VirtualKeyWithScopes,
  tx?: Prisma.TransactionClient,
): Promise<EligibleModelProvider[]> {
  const client = tx ?? prisma;

  const candidates = await scopeReachableModelProvidersForVk(prisma, vk, tx);
  if (candidates.length === 0) return [];

  if (vk.routingPolicyId) {
    const policy = await client.routingPolicy.findUnique({
      where: { id: vk.routingPolicyId },
      select: { modelProviderIds: true, organizationId: true },
    });
    if (!policy || policy.organizationId !== vk.organizationId) return [];
    const orderedIds = parseModelProviderIds(policy.modelProviderIds);
    if (orderedIds.length === 0) return [];
    const byId = new Map(candidates.map((mp) => [mp.id, mp]));
    return orderedIds
      .map((id) => byId.get(id))
      .filter((mp): mp is ModelProvider => Boolean(mp));
  }

  return candidates.sort(deterministicMpOrder);
}

function deterministicMpOrder(a: ModelProvider, b: ModelProvider): number {
  const pa = a.fallbackPriorityGlobal;
  const pb = b.fallbackPriorityGlobal;
  if (pa !== null && pb !== null && pa !== pb) return pa - pb;
  if (pa !== null && pb === null) return -1;
  if (pa === null && pb !== null) return 1;
  return a.createdAt.getTime() - b.createdAt.getTime();
}

type ScopePredicate =
  | { scopeType: "ORGANIZATION"; scopeId: string }
  | { scopeType: "TEAM"; scopeId: string | { in: string[] } }
  | { scopeType: "PROJECT"; scopeId: string | { in: string[] } };

async function buildScopePredicates(
  client: PrismaClient | Prisma.TransactionClient,
  vk: VirtualKeyWithScopes,
): Promise<ScopePredicate[]> {
  const orgIds = new Set<string>([vk.organizationId]);
  const teamIds = new Set<string>();
  const projectIds = new Set<string>();

  // Track the project IDs whose team we still need to resolve so a VK
  // scoped at PROJECT:P inherits TEAM:P.teamId visibility on MPs.
  const projectIdsNeedingTeam = new Set<string>();

  for (const entry of vk.scopes) {
    switch (entry.scopeType) {
      case "ORGANIZATION":
        orgIds.add(entry.scopeId);
        break;
      case "TEAM":
        teamIds.add(entry.scopeId);
        break;
      case "PROJECT":
        projectIds.add(entry.scopeId);
        projectIdsNeedingTeam.add(entry.scopeId);
        break;
    }
  }

  if (projectIdsNeedingTeam.size > 0) {
    const projects = await client.project.findMany({
      where: { id: { in: [...projectIdsNeedingTeam] } },
      select: { id: true, teamId: true },
    });
    for (const p of projects) teamIds.add(p.teamId);
  }

  const predicates: ScopePredicate[] = [];
  for (const id of orgIds) {
    predicates.push({ scopeType: "ORGANIZATION", scopeId: id });
  }
  if (teamIds.size > 0) {
    predicates.push({
      scopeType: "TEAM",
      scopeId: { in: [...teamIds] },
    });
  }
  if (projectIds.size > 0) {
    predicates.push({
      scopeType: "PROJECT",
      scopeId: { in: [...projectIds] },
    });
  }
  return predicates;
}

function parseModelProviderIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === "string" && v.length > 0);
}
