import { RoleBindingScopeType, type PrismaClient } from "@prisma/client";

export class RoleBindingService {
  constructor(private readonly prisma: PrismaClient) {}

  async listForUser({ organizationId, userId }: { organizationId: string; userId: string }) {
    const bindings = await this.prisma.roleBinding.findMany({
      where: { organizationId, userId },
      include: {
        customRole: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    const orgIds = bindings.filter((b) => b.scopeType === RoleBindingScopeType.ORGANIZATION).map((b) => b.scopeId);
    const teamIds = bindings.filter((b) => b.scopeType === RoleBindingScopeType.TEAM).map((b) => b.scopeId);
    const projectIds = bindings.filter((b) => b.scopeType === RoleBindingScopeType.PROJECT).map((b) => b.scopeId);

    const [orgs, teams, projects] = await Promise.all([
      orgIds.length > 0
        ? this.prisma.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } })
        : [],
      teamIds.length > 0
        ? this.prisma.team.findMany({ where: { id: { in: teamIds }, organizationId }, select: { id: true, name: true } })
        : [],
      projectIds.length > 0
        ? this.prisma.project.findMany({ where: { id: { in: projectIds }, team: { organizationId } }, select: { id: true, name: true } })
        : [],
    ]);

    const scopeNames = new Map<string, string>();
    for (const o of orgs) scopeNames.set(o.id, o.name);
    for (const t of teams) scopeNames.set(t.id, t.name);
    for (const p of projects) scopeNames.set(p.id, p.name);

    return bindings.map((b) => ({
      id: b.id,
      userId: b.userId,
      role: b.role,
      customRoleId: b.customRoleId,
      customRoleName: b.customRole?.name ?? null,
      scopeType: b.scopeType,
      scopeId: b.scopeId,
      scopeName: scopeNames.get(b.scopeId) ?? null,
      createdAt: b.createdAt,
    }));
  }
}
