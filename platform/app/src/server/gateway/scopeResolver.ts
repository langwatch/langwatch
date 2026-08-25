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
 * The second half of the file answers a different question about the same
 * key: where its traces and costs land. That one is stored on the key rather
 * than derived, so what lives here is the write-time decision that fills the
 * column and the read that follows it.
 */
import type { ModelProvider, Prisma, PrismaClient } from "~/generated/prisma/client";
import { isDispatchableProvider } from "~/server/modelProviders/registry";
import type { ScopeInput, VirtualKeyWithScopes } from "./virtualKey.repository";

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

/**
 * Where a virtual key's traces and costs land.
 *
 * This is a stored fact on the key, not a derivation. It is decided once at
 * write time by `decideTraceDestination` and read back by following the
 * pointer. The chain it replaced (explicit, then single project scope, then
 * governance) answered on every read, which meant three lookups that each had
 * to remember that a deleted project is not a destination, and a key whose
 * answer could change because somebody edited a different screen.
 */
export type TraceProject = {
  id: string;
  teamId: string;
  apiKey: string;
  /** Set when the customer deleted the project; deletion is soft. */
  archivedAt: Date | null;
};

type ProjectClient = PrismaClient | Prisma.TransactionClient;

const TRACE_PROJECT_FIELDS = {
  id: true,
  teamId: true,
  apiKey: true,
  archivedAt: true,
} as const;

/**
 * The project a key's stored pointer names, followed as-is.
 *
 * Deliberately not archived-aware: the write path refuses a destination that
 * is deleted, and once a key is running, a deletion performed on a different
 * screen must not reroute its traffic or take it down. The spans keep landing
 * where they have always landed, the data is intact, and it reappears if the
 * customer restores the project. The state is surfaced instead, on the key.
 */
export async function traceProjectFor(
  client: ProjectClient,
  traceProjectId: string | null | undefined,
): Promise<TraceProject | null> {
  if (!traceProjectId) return null;
  return await client.project.findUnique({
    where: { id: traceProjectId },
    select: TRACE_PROJECT_FIELDS,
  });
}

/**
 * `traceProjectFor` for many keys at once, in one query. Used wherever a
 * listing has to say where each of an organization's keys sends its traffic;
 * an organization running a project per customer has hundreds of keys, and
 * this must not be a query per row.
 */
export async function traceProjectsByIds(
  client: ProjectClient,
  traceProjectIds: (string | null | undefined)[],
): Promise<Map<string, TraceProject>> {
  const ids = [
    ...new Set(
      traceProjectIds.filter(
        (id): id is string => typeof id === "string" && id.length > 0,
      ),
    ),
  ];
  if (ids.length === 0) return new Map();
  const rows = await client.project.findMany({
    where: { id: { in: ids } },
    select: TRACE_PROJECT_FIELDS,
  });
  return new Map(rows.map((row) => [row.id, row]));
}

/**
 * What a key being written should store as its trace destination. Narrower
 * than `VirtualKeyWithScopes` so a drawer draft (no key row yet) satisfies it
 * structurally; if the decision ever needs another field of the key, the
 * draft call sites stop compiling instead of silently passing undefined.
 */
export type TraceDestinationInput = {
  organizationId: string;
  scopes: ScopeInput[];
  /**
   * The destination the caller named, if any. Stored apart from the access
   * scopes because scope rows grant visibility and operate rights, and the
   * trace destination must grant neither.
   */
  traceProjectId?: string | null;
};

/**
 * The answer, or the reason there is none. A discriminated result rather than
 * a throw because the same decision runs on two paths with two duties: the
 * write path turns each refusal into its own customer-facing error, and the
 * create drawer previews the destination for a draft and must render a
 * "cannot be saved yet" state rather than blow up mid-render.
 */
export type TraceDestinationDecision =
  | { outcome: "resolved"; project: TraceProject }
  /** The destination named is not a live project of this organization. */
  | { outcome: "unknown" }
  /**
   * Nothing was named, nothing can be taken from the scopes, and the
   * organization has real projects that could have been named.
   */
  | { outcome: "ambiguous"; projectScopeCount: number }
  /** Nothing was named and the organization has no governance project. */
  | { outcome: "no_destination" };

/**
 * Decide, once, where a key's traces and costs will land.
 *
 * Four cases, in order:
 *
 *   1. A named destination: a live project of this organization, or the key
 *      is refused. Falling through to a later case would save the key with
 *      its traffic attributed to a project its own `trace_project_id` denies.
 *   2. Exactly one PROJECT access scope naming a live project: that project.
 *      It is the only destination the key could mean.
 *   3. Neither, while the organization has real projects to choose from:
 *      refused as ambiguous. The governance inbox would keep the spend
 *      visible and put it under a project nobody named, so every project
 *      budget the creator had in mind counts none of this key's traffic.
 *   4. Neither, and there is nothing else to name: the organization's oldest
 *      live governance project, so the key's spans land in the AI Governance
 *      inbox alongside the receiver-side ones. An organization without one
 *      (older self-hosted deploys) has no destination to give.
 *
 * Rules 3 and 4 are the same shape seen against different data, which is why
 * they answer here together rather than in a caller that would have to
 * re-count the organization's projects to tell them apart.
 */
export async function decideTraceDestination(
  client: ProjectClient,
  input: TraceDestinationInput,
): Promise<TraceDestinationDecision> {
  if (input.traceProjectId) {
    const named = await liveProjectInOrganization(client, {
      organizationId: input.organizationId,
      projectId: input.traceProjectId,
    });
    return named ? { outcome: "resolved", project: named } : { outcome: "unknown" };
  }

  const projectScopes = input.scopes.filter((s) => s.scopeType === "PROJECT");
  if (projectScopes.length === 1) {
    const scoped = await liveProjectInOrganization(client, {
      organizationId: input.organizationId,
      projectId: projectScopes[0]!.scopeId,
    });
    if (scoped) return { outcome: "resolved", project: scoped };
  }

  // The governance project answers first, so an organization that has none
  // is told it has no destination at all rather than told to choose between
  // projects it could name: "there is nowhere for this key's traces to go"
  // is the more useful half of the truth, and it is the one an operator has
  // to act on.
  const governance = await oldestGovernanceProject(client, input.organizationId);
  if (!governance) return { outcome: "no_destination" };

  // An organization whose only live project IS the governance one is left
  // alone: there would be nothing else to pick, and refusing the key for not
  // choosing between no options helps nobody. A deleted project is not an
  // option either, which is why this counts only live ones.
  const alternatives = await client.project.count({
    where: {
      team: { organizationId: input.organizationId },
      kind: { not: "internal_governance" },
      archivedAt: null,
    },
  });
  return alternatives > 0
    ? { outcome: "ambiguous", projectScopeCount: projectScopes.length }
    : { outcome: "resolved", project: governance };
}

/**
 * A project of this organization that the customer has not deleted.
 *
 * The one validation lookup the write path has. Org-pinned because the id is
 * request-supplied: without it a stray id would land this organization's
 * traces, and its spend, in another tenant's project. Archived-aware because
 * a deleted project is a place the customer removed, not a destination.
 */
async function liveProjectInOrganization(
  client: ProjectClient,
  args: { organizationId: string; projectId: string },
): Promise<TraceProject | null> {
  return await client.project.findFirst({
    where: {
      id: args.projectId,
      team: { organizationId: args.organizationId },
      archivedAt: null,
    },
    select: TRACE_PROJECT_FIELDS,
  });
}

/**
 * The organization's oldest live governance project. An archived one is
 * passed over for the next, and an organization whose governance projects are
 * all deleted answers as one that never had any.
 */
async function oldestGovernanceProject(
  client: ProjectClient,
  organizationId: string,
): Promise<TraceProject | null> {
  return await client.project.findFirst({
    where: {
      kind: "internal_governance",
      team: { organizationId },
      archivedAt: null,
    },
    select: TRACE_PROJECT_FIELDS,
    // Ties on createdAt break on id so two callers pick the same project.
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}
