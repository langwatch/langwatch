import type { PrismaClient, Project } from "@prisma/client";
import type {
  ProjectRepository,
  ProjectWithOrgAdmin,
  ProjectWithTeam,
} from "./project.repository";

export class PrismaProjectRepository implements ProjectRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async getById(id: string): Promise<Project | null> {
    return this.prisma.project.findUnique({ where: { id } });
  }

  async getWithTeam(id: string): Promise<ProjectWithTeam | null> {
    return this.prisma.project.findUnique({
      where: { id, archivedAt: null },
      include: { team: true },
    });
  }

  async getWithOrgAdmin(id: string): Promise<ProjectWithOrgAdmin | null> {
    const project = await this.prisma.project.findUnique({
      where: { id },
      select: {
        firstMessage: true,
        team: {
          select: {
            organization: {
              select: {
                id: true,
                members: {
                  where: { role: "ADMIN" },
                  select: { userId: true },
                  orderBy: { createdAt: "asc" },
                  take: 1,
                },
              },
            },
          },
        },
      },
    });

    if (!project) return null;

    const org = project.team?.organization;
    return {
      firstMessage: project.firstMessage,
      organizationId: org?.id ?? null,
      adminUserId: org?.members?.[0]?.userId ?? null,
    };
  }
}
