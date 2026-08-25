/**
 * The one resolver for "what does this budget scope point at, for humans".
 *
 * Every budget surface needs the same lookup: given (scopeType, scopeId)
 * pairs, return the target's display name plus the secondary bits each
 * view renders (slug, email, member count, VK prefix). The budgets list,
 * the budget detail page, the VK drawer's "already applies" list and the
 * budget-overview service all read this module, so the same team can
 * never render under two different names depending on the page.
 *
 * Batch-shaped: one findMany per scope kind regardless of how many
 * budgets are being labelled.
 */
import type { PrismaClient } from "~/generated/prisma/client";
import {
  LIVE_MEMBERSHIP,
  liveGroups,
} from "~/server/app-layer/authz/repositories/live-rows";

export type BudgetScopeTargetInfo = {
  kind: string;
  id: string;
  name: string;
  secondary: string | null;
  /** VIRTUAL_KEY targets only: slug of the key's trace project, if one. */
  projectSlug?: string | null;
  /** GROUP targets only: how many members the per-member allowance covers. */
  memberCount?: number;
};

export function scopeTargetKey(scopeType: string, scopeId: string): string {
  return `${scopeType}:${scopeId}`;
}

/**
 * Resolve display targets for a set of budget scopes, grouped by scopeType
 * so each scope kind costs at most one findMany. VK, GROUP and PRINCIPAL
 * lookups are pinned to `organizationId` so a stray scopeId can never
 * surface another tenant's name, key or member.
 */
export async function resolveScopeTargetsBatch(
  prisma: PrismaClient,
  budgets: Array<{ scopeType: string; scopeId: string }>,
  organizationId: string | null,
): Promise<Map<string, BudgetScopeTargetInfo>> {
  const ids: Record<string, Set<string>> = {
    ORGANIZATION: new Set(),
    TEAM: new Set(),
    PROJECT: new Set(),
    VIRTUAL_KEY: new Set(),
    PRINCIPAL: new Set(),
    GROUP: new Set(),
    ATTRIBUTED_USER: new Set(),
  };
  for (const b of budgets) {
    ids[b.scopeType]?.add(b.scopeId);
  }

  const out = new Map<string, BudgetScopeTargetInfo>();
  await Promise.all([
    addNamedTargets({
      out,
      prisma,
      kind: "ORGANIZATION",
      idSet: ids.ORGANIZATION!,
    }),
    addNamedTargets({ out, prisma, kind: "TEAM", idSet: ids.TEAM! }),
    addNamedTargets({ out, prisma, kind: "PROJECT", idSet: ids.PROJECT! }),
    addVirtualKeyTargets({
      out,
      prisma,
      idSet: ids.VIRTUAL_KEY!,
      organizationId,
    }),
    addPrincipalTargets({
      out,
      prisma,
      idSet: ids.PRINCIPAL!,
      organizationId,
    }),
    addGroupTargets({ out, prisma, idSet: ids.GROUP!, organizationId }),
    addAttributedUserTargets({
      out,
      prisma,
      idSet: ids.ATTRIBUTED_USER!,
      organizationId,
    }),
  ]);
  return out;
}

type AddTargetArgs = {
  out: Map<string, BudgetScopeTargetInfo>;
  prisma: PrismaClient;
  idSet: Set<string>;
  organizationId?: string | null;
};

/** ORGANIZATION / TEAM / PROJECT all resolve to (name, slug). */
async function addNamedTargets({
  out,
  prisma,
  kind,
  idSet,
}: AddTargetArgs & {
  kind: "ORGANIZATION" | "TEAM" | "PROJECT";
}): Promise<void> {
  if (idSet.size === 0) return;
  const where = { where: { id: { in: [...idSet] } } };
  const select = { select: { id: true, name: true, slug: true } };
  const rows =
    kind === "ORGANIZATION"
      ? await prisma.organization.findMany({ ...where, ...select })
      : kind === "TEAM"
        ? await prisma.team.findMany({ ...where, ...select })
        : await prisma.project.findMany({ ...where, ...select });
  for (const r of rows) {
    out.set(scopeTargetKey(kind, r.id), {
      kind,
      id: r.id,
      name: r.name,
      secondary: r.slug,
    });
  }
}

async function addVirtualKeyTargets({
  out,
  prisma,
  idSet,
  organizationId,
}: AddTargetArgs): Promise<void> {
  if (idSet.size === 0 || !organizationId) return;
  const vks = await prisma.virtualKey.findMany({
    where: { id: { in: [...idSet] }, organizationId },
    select: {
      id: true,
      name: true,
      displayPrefix: true,
      scopes: {
        where: { scopeType: "PROJECT" },
        select: { scopeId: true },
        take: 1,
      },
    },
  });
  // Derive the project slug (if any) from the first PROJECT-scope row
  // on the VK — used only as a UI breadcrumb. Cheap inline lookup; the
  // batch is bounded by `idSet.size`.
  const projectIdsForSlugs = vks
    .map((vk) => vk.scopes[0]?.scopeId)
    .filter((id): id is string => typeof id === "string");
  const projectSlugById = new Map<string, string>(
    projectIdsForSlugs.length
      ? (
          await prisma.project.findMany({
            where: { id: { in: projectIdsForSlugs } },
            select: { id: true, slug: true },
          })
        ).map((p) => [p.id, p.slug])
      : [],
  );
  for (const vk of vks) {
    out.set(scopeTargetKey("VIRTUAL_KEY", vk.id), {
      kind: "VIRTUAL_KEY",
      id: vk.id,
      name: vk.name,
      secondary: vk.displayPrefix ? `${vk.displayPrefix}…` : null,
      projectSlug: projectSlugById.get(vk.scopes[0]?.scopeId ?? "") ?? null,
    });
  }
}

async function addPrincipalTargets({
  out,
  prisma,
  idSet,
  organizationId,
}: AddTargetArgs): Promise<void> {
  // Same tenant pin as the VIRTUAL_KEY and GROUP branches, and the one
  // that matters most: this row carries a person's name and email, so a
  // stray scopeId must never resolve to a user outside the organization.
  if (idSet.size === 0 || !organizationId) return;
  const users = await prisma.user.findMany({
    where: {
      id: { in: [...idSet] },
      orgMemberships: { some: { organizationId } },
    },
    select: { id: true, name: true, email: true },
  });
  for (const u of users) {
    out.set(scopeTargetKey("PRINCIPAL", u.id), {
      kind: "PRINCIPAL",
      id: u.id,
      name: u.name ?? u.email ?? u.id,
      secondary: u.email ?? null,
    });
  }
}

async function addGroupTargets({
  out,
  prisma,
  idSet,
  organizationId,
}: AddTargetArgs): Promise<void> {
  // Same tenant pin as the VIRTUAL_KEY branch: a stray scopeId must not
  // surface another organization's group name.
  if (idSet.size === 0 || !organizationId) return;
  const groups = await liveGroups(prisma).findMany({
    where: { id: { in: [...idSet] }, organizationId },
    select: {
      id: true,
      name: true,
      slug: true,
      // LIVE members: the count says how many people a per-member allowance
      // covers now, which people who left the group are not.
      _count: { select: { members: { where: LIVE_MEMBERSHIP } } },
    },
  });
  for (const g of groups) {
    out.set(scopeTargetKey("GROUP", g.id), {
      kind: "GROUP",
      id: g.id,
      name: g.name,
      secondary: g.slug,
      memberCount: g._count.members,
    });
  }
}

async function addAttributedUserTargets({
  out,
  prisma,
  idSet,
  organizationId,
}: AddTargetArgs): Promise<void> {
  // A per-person template anchors on a virtual key or a project, and the
  // scopeId alone does not say which, so both are asked for and the key
  // wins where an id somehow matches both.
  if (idSet.size === 0 || !organizationId) return;
  const anchorIds = [...idSet];
  const [anchorKeys, anchorProjects] = await Promise.all([
    prisma.virtualKey.findMany({
      where: { id: { in: anchorIds }, organizationId },
      select: { id: true, name: true, displayPrefix: true },
    }),
    prisma.project.findMany({
      where: { id: { in: anchorIds }, team: { organizationId } },
      select: { id: true, name: true, slug: true },
    }),
  ]);
  for (const p of anchorProjects) {
    out.set(scopeTargetKey("ATTRIBUTED_USER", p.id), {
      kind: "ATTRIBUTED_USER",
      id: p.id,
      name: p.name,
      secondary: p.slug,
    });
  }
  for (const vk of anchorKeys) {
    out.set(scopeTargetKey("ATTRIBUTED_USER", vk.id), {
      kind: "ATTRIBUTED_USER",
      id: vk.id,
      name: vk.name,
      secondary: vk.displayPrefix ? `${vk.displayPrefix}…` : null,
    });
  }
}
