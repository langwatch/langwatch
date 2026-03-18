import type { PrismaClient, Project } from "@prisma/client";
import type { ProjectRepository, ProjectWithTeam } from "./project.repository";

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

  async updateMetadata(
    id: string,
    data: { firstMessage: boolean; integrated: boolean; language: string },
  ): Promise<void> {
    await this.prisma.project.update({ where: { id }, data });
  }
}
