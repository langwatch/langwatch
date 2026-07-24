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
 */
import type {
  ModelProvider,
  PrismaClient,
  Prisma,
  Team,
} from "@prisma/client";

import type { VirtualKeyWithScopes } from "./virtualKey.repository";

export type EligibleModelProvider = ModelProvider;

export async function eligibleModelProvidersForVk(
  prisma: PrismaClient,
  vk: VirtualKeyWithScopes,
  tx?: Prisma.TransactionClient,
): Promise<EligibleModelProvider[]> {
  const client = tx ?? prisma;

  const scopePredicates = await buildScopePredicates(client, vk);
  if (scopePredicates.length === 0) return [];

  const candidates = await client.modelProvider.findMany({
    where: {
      enabled: true,
      disabledAt: null,
      scopes: { some: { OR: scopePredicates } },
    },
  });

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

/**
 * Resolve the project whose API key the gateway should use as
 * `X-Auth-Token` when exporting OTLP spans for this VK's traffic. Rules:
 *
 *   - PROJECT-scoped VK with exactly one PROJECT scope -> that project.
 *   - Otherwise (TEAM/ORG-scoped, or PROJECT-scoped at multiple projects,
 *     which is rare but valid) -> the org's `internal_governance` project
 *     so spans land in the AI Governance ingestion inbox alongside the
 *     receiver-side spans. Same project_id that ingestion-sources point
 *     at, so a single trace-search filter surfaces both VK spans and
 *     receiver spans.
 *   - Org has no `internal_governance` project (older self-hosted deploys
 *     pre-governance) -> null. The materialiser then null-stamps
 *     `project_id` / `project_otlp_token` in the bundle and the gateway
 *     skips span export rather than 500-ing.
 */
export async function resolveTraceProject(
  prisma: PrismaClient,
  vk: VirtualKeyWithScopes,
  tx?: Prisma.TransactionClient,
): Promise<{ id: string; teamId: string; apiKey: string } | null> {
  const client = tx ?? prisma;
  const projectScopes = vk.scopes.filter((s) => s.scopeType === "PROJECT");
  if (projectScopes.length === 1) {
    const proj = await client.project.findUnique({
      where: { id: projectScopes[0]!.scopeId },
      select: { id: true, teamId: true, apiKey: true },
    });
    if (proj) return proj;
  }

  const governanceProjects: Array<{ id: string; teamId: string; apiKey: string; team: Pick<Team, "organizationId"> }> =
    await client.project.findMany({
      where: {
        kind: "internal_governance",
        team: { organizationId: vk.organizationId },
      },
      select: {
        id: true,
        teamId: true,
        apiKey: true,
        team: { select: { organizationId: true } },
      },
      orderBy: { createdAt: "asc" },
      take: 1,
    });
  const gov = governanceProjects[0];
  if (!gov) return null;
  return { id: gov.id, teamId: gov.teamId, apiKey: gov.apiKey };
}
