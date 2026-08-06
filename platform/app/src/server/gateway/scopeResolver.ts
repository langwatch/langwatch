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
import type { ModelProvider, Prisma, PrismaClient, Team } from "@prisma/client";

import type { ScopeInput, VirtualKeyWithScopes } from "./virtualKey.repository";

/**
 * The two fields trace-project resolution actually reads. Narrower than
 * `VirtualKeyWithScopes` so a drawer draft (no key row yet) satisfies it
 * structurally; if resolution ever needs another field of the key, the
 * draft call sites stop compiling instead of silently passing undefined.
 */
export type TraceProjectInput = {
  organizationId: string;
  scopes: ScopeInput[];
  /**
   * The explicit destination an org- or team-owned key carries. Stored
   * apart from the access scopes because scope rows grant visibility and
   * operate rights, and the trace destination must grant neither.
   */
  traceProjectId?: string | null;
};

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
 *
 * Null is a read-path tolerance for keys that already exist, not a shape
 * new writes may take: VirtualKeyService refuses create/update when this
 * resolves null (`trace_project_required`), because dropped traces mean
 * spend no budget can ever see.
 */
export async function resolveTraceProject(
  prisma: PrismaClient,
  vk: TraceProjectInput,
  tx?: Prisma.TransactionClient,
): Promise<TraceProject | null> {
  const [resolved] = await resolveTraceProjects(prisma, [vk], tx);
  return resolved ?? null;
}

export type TraceProject = { id: string; teamId: string; apiKey: string };

/**
 * `resolveTraceProject` for many keys at once, answering in a fixed number
 * of queries instead of up to three per key.
 *
 * Returns one entry per input, in the order given. The stages run only when
 * some key still needs them, so resolving a single key costs exactly what
 * the one-key call always cost; an organization with hundreds of keys costs
 * the same three queries as one with two.
 *
 * Every rule lives here and nowhere else. Reach checking, config
 * materialisation and key validation all have to agree on where a key's
 * traces land, and a second implementation of "explicit, then unique scope,
 * then governance" is exactly how they would stop agreeing.
 */
export async function resolveTraceProjects(
  prisma: PrismaClient,
  vks: TraceProjectInput[],
  tx?: Prisma.TransactionClient,
): Promise<(TraceProject | null)[]> {
  const client = tx ?? prisma;
  if (vks.length === 0) return [];

  const organizationIds = [...new Set(vks.map((vk) => vk.organizationId))];
  const resolved = new Array<TraceProject | null>(vks.length).fill(null);
  let pending = vks.map((_, index) => index);

  const settle = (
    indices: number[],
    pick: (index: number) => TraceProject | undefined,
  ) => {
    pending = indices.filter((index) => {
      const hit = pick(index);
      if (!hit) return true;
      resolved[index] = hit;
      return false;
    });
  };

  const byOrgAndId = await explicitDestinations(client, {
    vks,
    indices: pending,
    organizationIds,
  });
  settle(pending, (index) => {
    const vk = vks[index]!;
    if (!vk.traceProjectId) return undefined;
    return byOrgAndId.get(orgScopedKey(vk.organizationId, vk.traceProjectId));
  });

  const uniqueScopeIds = uniqueProjectScopeIds(vks, pending);
  const byId = await scopedDestinations(client, uniqueScopeIds);
  settle(pending, (index) => {
    const scopeId = uniqueScopeIds.get(index);
    return scopeId ? byId.get(scopeId) : undefined;
  });

  // Whatever is left falls back to the org's governance project, so its
  // spans land in the AI Governance inbox alongside the receiver-side ones.
  // An organization without one (older self-hosted deploys) answers null,
  // and the materialiser then skips span export rather than failing.
  if (pending.length > 0) {
    const governance = await governanceProjectByOrg(client, organizationIds);
    for (const index of pending) {
      resolved[index] = governance.get(vks[index]!.organizationId) ?? null;
    }
  }

  return resolved;
}

/**
 * The explicit trace destinations, keyed by organization and id. Org-pinned
 * because the column is request-supplied: a stray id must fall through to
 * the key's scope rather than land this organization's traces in another
 * tenant's project.
 */
async function explicitDestinations(
  client: ProjectClient,
  args: {
    vks: TraceProjectInput[];
    indices: number[];
    organizationIds: string[];
  },
): Promise<Map<string, TraceProject>> {
  const ids = args.indices
    .map((index) => args.vks[index]!.traceProjectId)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  if (ids.length === 0) return new Map();
  return await projectsByOrgAndId(client, {
    ids,
    organizationIds: args.organizationIds,
  });
}

/** The one PROJECT access scope a key has, for the keys that have exactly one. */
function uniqueProjectScopeIds(
  vks: TraceProjectInput[],
  indices: number[],
): Map<number, string> {
  const byIndex = new Map<number, string>();
  for (const index of indices) {
    const projectScopes = vks[index]!.scopes.filter(
      (s) => s.scopeType === "PROJECT",
    );
    if (projectScopes.length === 1) {
      byIndex.set(index, projectScopes[0]!.scopeId);
    }
  }
  return byIndex;
}

/**
 * Projects named by a key's single access scope. Deliberately not
 * org-pinned, matching the one-key lookup this replaced: a scope row is
 * validated against the organization when it is written.
 */
async function scopedDestinations(
  client: ProjectClient,
  scopeIdByIndex: Map<number, string>,
): Promise<Map<string, TraceProject>> {
  if (scopeIdByIndex.size === 0) return new Map();
  const rows = await client.project.findMany({
    where: { id: { in: [...new Set(scopeIdByIndex.values())] } },
    select: { id: true, teamId: true, apiKey: true },
  });
  return new Map(rows.map((row) => [row.id, row]));
}

type ProjectClient = PrismaClient | Prisma.TransactionClient;

async function projectsByOrgAndId(
  client: ProjectClient,
  args: { ids: string[]; organizationIds: string[] },
): Promise<Map<string, TraceProject>> {
  const rows: Array<TraceProject & { team: Pick<Team, "organizationId"> }> =
    await client.project.findMany({
      where: {
        id: { in: [...new Set(args.ids)] },
        team: { organizationId: { in: args.organizationIds } },
      },
      select: {
        id: true,
        teamId: true,
        apiKey: true,
        team: { select: { organizationId: true } },
      },
    });
  return new Map(
    rows.map((row) => [
      orgScopedKey(row.team.organizationId, row.id),
      { id: row.id, teamId: row.teamId, apiKey: row.apiKey },
    ]),
  );
}

/** Oldest governance project per organization, matching the one-key rule. */
async function governanceProjectByOrg(
  client: ProjectClient,
  organizationIds: string[],
): Promise<Map<string, TraceProject>> {
  const rows: Array<TraceProject & { team: Pick<Team, "organizationId"> }> =
    await client.project.findMany({
      where: {
        kind: "internal_governance",
        team: { organizationId: { in: organizationIds } },
      },
      select: {
        id: true,
        teamId: true,
        apiKey: true,
        team: { select: { organizationId: true } },
      },
      orderBy: { createdAt: "asc" },
    });
  const byOrg = new Map<string, TraceProject>();
  for (const row of rows) {
    if (byOrg.has(row.team.organizationId)) continue;
    byOrg.set(row.team.organizationId, {
      id: row.id,
      teamId: row.teamId,
      apiKey: row.apiKey,
    });
  }
  return byOrg;
}

/**
 * Project ids are globally unique, but the explicit-destination lookup is
 * org-pinned on purpose, so the map has to be keyed by the pair or a
 * cross-tenant id would read as a hit for whichever org asked.
 */
function orgScopedKey(organizationId: string, projectId: string): string {
  return `${organizationId}:${projectId}`;
}
