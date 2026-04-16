import { RoleBindingScopeType, type PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import type { RoleBindingForSynthesis, RoleBindingRepository } from "./role-binding.repository";

export class PrismaRoleBindingRepository implements RoleBindingRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listForOrganizationsAndUser({
    orgIds,
    userId,
  }: {
    orgIds: string[];
    userId: string;
  }): Promise<RoleBindingForSynthesis[]> {
    return this.prisma.roleBinding.findMany({
      where: {
        organizationId: { in: orgIds },
        OR: [
          { userId },
          { group: { members: { some: { userId } } } },
        ],
        scopeType: {
          in: [
            RoleBindingScopeType.TEAM,
            RoleBindingScopeType.ORGANIZATION,
            RoleBindingScopeType.PROJECT,
          ],
        },
      },
      select: {
        organizationId: true,
        scopeType: true,
        scopeId: true,
        role: true,
        customRoleId: true,
        customRole: {
          select: {
            id: true,
            name: true,
            description: true,
            permissions: true,
            organizationId: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    });
  }

  async validateScopeInOrg({
    organizationId,
    scopeType,
    scopeId,
  }: {
    organizationId: string;
    scopeType: RoleBindingScopeType;
    scopeId: string;
  }): Promise<void> {
    if (scopeType === RoleBindingScopeType.ORGANIZATION) {
      if (scopeId !== organizationId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid org scope" });
      }
      return;
    }

    if (scopeType === RoleBindingScopeType.TEAM) {
      const team = await this.prisma.team.findFirst({
        where: { id: scopeId, organizationId },
      });
      if (!team) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Team not found in this org" });
      }
      return;
    }

    if (scopeType === RoleBindingScopeType.PROJECT) {
      const project = await this.prisma.project.findFirst({
        where: { id: scopeId },
        include: { team: { select: { organizationId: true } } },
      });
      if (!project || project.team.organizationId !== organizationId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found in this org" });
      }
    }
  }
}
