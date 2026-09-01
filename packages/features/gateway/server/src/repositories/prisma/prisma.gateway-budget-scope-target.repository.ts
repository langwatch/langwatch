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
import { scopeTargetKey } from "@langwatch/gateway-contract";
import type { ProjectIdentity } from "@langwatch/project-contract";
import type { GatewayVirtualKeyProjectScope } from "../gateway-budget.repository";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

/** The client slice scope-target expansion reads. */
export type GatewayBudgetScopeTargetDatabase = Pick<
  PrismaClient,
  "group" | "organization" | "team" | "user" | "virtualKey"
>;

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

type AddTargetArgs = {
  out: Map<string, BudgetScopeTargetInfo>;
  prisma: GatewayBudgetScopeTargetDatabase;
  idSet: Set<string>;
  organizationId?: string | null;
};

/**
 * Which spend targets a set of budgets resolves to.
 *
 * A budget names a scope, not the rows that scope covers, and the six `add*`
 * steps below are the six ways a scope expands: by name, project, virtual key,
 * principal, group and attributed user. They only exist to serve the batch
 * resolve, which is why they are private, and they are collected here rather
 * than left loose because a scope kind that expands differently from the rest
 * is the bug this shape makes visible.
 */
export class PrismaGatewayBudgetScopeTargetRepository {
  /** ORGANIZATION and TEAM both resolve to (name, slug). */
  private static async addNamedTargets({
    out,
    prisma,
    kind,
    idSet,
  }: AddTargetArgs & {
    kind: "ORGANIZATION" | "TEAM";
  }): Promise<void> {
    if (idSet.size === 0) return;
    const where = { where: { id: { in: [...idSet] } } };
    const select = { select: { id: true, name: true, slug: true } };
    const rows =
      kind === "ORGANIZATION"
        ? await prisma.organization.findMany({ ...where, ...select })
        : await prisma.team.findMany({ ...where, ...select });
    for (const r of rows) {
      out.set(scopeTargetKey(kind, r.id), {
        kind,
        id: r.id,
        name: r.name,
        secondary: r.slug,
      });
    }
  }

  private static addProjectTargets({
    out,
    idSet,
    projectsById,
  }: {
    out: Map<string, BudgetScopeTargetInfo>;
    idSet: Set<string>;
    projectsById: Map<string, ProjectIdentity>;
  }): void {
    for (const id of idSet) {
      const project = projectsById.get(id);
      if (!project) continue;

      out.set(scopeTargetKey("PROJECT", project.id), {
        kind: "PROJECT",
        id: project.id,
        name: project.name,
        secondary: project.slug,
      });
    }
  }

  private static async addVirtualKeyTargets({
    out,
    prisma,
    idSet,
    organizationId,
    projectsById,
    projectScopeIdByVirtualKeyId,
  }: AddTargetArgs & {
    projectsById: Map<string, ProjectIdentity>;
    projectScopeIdByVirtualKeyId: Map<string, string>;
  }): Promise<void> {
    if (idSet.size === 0 || !organizationId) return;
    const vks = await prisma.virtualKey.findMany({
      where: { id: { in: [...idSet] }, organizationId },
      select: {
        id: true,
        name: true,
        displayPrefix: true,
      },
    });
    for (const vk of vks) {
      const projectId = projectScopeIdByVirtualKeyId.get(vk.id);
      const project = projectId ? projectsById.get(projectId) : void 0;
      out.set(scopeTargetKey("VIRTUAL_KEY", vk.id), {
        kind: "VIRTUAL_KEY",
        id: vk.id,
        name: vk.name,
        secondary: vk.displayPrefix ? `${vk.displayPrefix}…` : null,
        projectSlug: project?.slug ?? null,
      });
    }
  }

  private static async addPrincipalTargets({
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

  private static async addGroupTargets({
    out,
    prisma,
    idSet,
    organizationId,
  }: AddTargetArgs): Promise<void> {
    // Same tenant pin as the VIRTUAL_KEY branch: a stray scopeId must not
    // surface another organization's group name.
    if (idSet.size === 0 || !organizationId) return;
    const groups = await prisma.group.findMany({
      where: { id: { in: [...idSet] }, organizationId },
      select: {
        id: true,
        name: true,
        slug: true,
        _count: { select: { members: true } },
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

  private static async addAttributedUserTargets({
    out,
    prisma,
    idSet,
    organizationId,
    projectsById,
  }: AddTargetArgs & { projectsById: Map<string, ProjectIdentity> }): Promise<void> {
    // A per-person template anchors on a virtual key or a project, and the
    // scopeId alone does not say which, so both are asked for and the key
    // wins where an id somehow matches both.
    if (idSet.size === 0 || !organizationId) return;
    const anchorIds = [...idSet];
    const anchorKeys = await prisma.virtualKey.findMany({
      where: { id: { in: anchorIds }, organizationId },
      select: { id: true, name: true, displayPrefix: true },
    });
    for (const id of anchorIds) {
      const project = projectsById.get(id);
      if (!project || project.organizationId !== organizationId) continue;

      out.set(scopeTargetKey("ATTRIBUTED_USER", project.id), {
        kind: "ATTRIBUTED_USER",
        id: project.id,
        name: project.name,
        secondary: project.slug,
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

  /**
   * Resolve display targets for a set of budget scopes, grouped by scopeType
   * so each scope kind costs at most one findMany. VK, GROUP and PRINCIPAL
   * lookups are pinned to `organizationId` so a stray scopeId can never
   * surface another tenant's name, key or member.
   */
  static async resolveScopeTargetsBatch(
    prisma: GatewayBudgetScopeTargetDatabase,
    budgets: Array<{ scopeType: string; scopeId: string }>,
    organizationId: string | null,
    projects: ProjectIdentity[],
    virtualKeyProjectScopes: GatewayVirtualKeyProjectScope[],
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
    const projectsById = new Map(projects.map((project) => [project.id, project]));
    const projectScopeIdByVirtualKeyId = new Map(
      virtualKeyProjectScopes.map((scope) => [scope.virtualKeyId, scope.projectId]),
    );
    await Promise.all([
      PrismaGatewayBudgetScopeTargetRepository.addNamedTargets({
        out,
        prisma,
        kind: "ORGANIZATION",
        idSet: ids.ORGANIZATION!,
      }),
      PrismaGatewayBudgetScopeTargetRepository.addNamedTargets({
        out,
        prisma,
        kind: "TEAM",
        idSet: ids.TEAM!,
      }),
      PrismaGatewayBudgetScopeTargetRepository.addProjectTargets({
        out,
        idSet: ids.PROJECT!,
        projectsById,
      }),
      PrismaGatewayBudgetScopeTargetRepository.addVirtualKeyTargets({
        out,
        prisma,
        idSet: ids.VIRTUAL_KEY!,
        organizationId,
        projectsById,
        projectScopeIdByVirtualKeyId,
      }),
      PrismaGatewayBudgetScopeTargetRepository.addPrincipalTargets({
        out,
        prisma,
        idSet: ids.PRINCIPAL!,
        organizationId,
      }),
      PrismaGatewayBudgetScopeTargetRepository.addGroupTargets({
        out,
        prisma,
        idSet: ids.GROUP!,
        organizationId,
      }),
      PrismaGatewayBudgetScopeTargetRepository.addAttributedUserTargets({
        out,
        prisma,
        idSet: ids.ATTRIBUTED_USER!,
        organizationId,
        projectsById,
      }),
    ]);
    return out;
  }

  static async listVirtualKeyProjectScopes(
    prisma: GatewayBudgetScopeTargetDatabase,
    organizationId: string | null,
    virtualKeyIds: string[],
  ): Promise<GatewayVirtualKeyProjectScope[]> {
    if (!organizationId || virtualKeyIds.length === 0) return [];

    const virtualKeys = await prisma.virtualKey.findMany({
      where: { id: { in: virtualKeyIds }, organizationId },
      select: {
        id: true,
        scopes: {
          where: { scopeType: "PROJECT" },
          select: { scopeId: true },
          take: 1,
        },
      },
    });

    return virtualKeys.flatMap((virtualKey) => {
      const projectId = virtualKey.scopes[0]?.scopeId;
      return projectId ? [{ virtualKeyId: virtualKey.id, projectId }] : [];
    });
  }
}
