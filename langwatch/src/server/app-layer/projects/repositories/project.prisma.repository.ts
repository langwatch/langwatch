import type { PrismaClient, Project } from "@prisma/client";
import type { ProjectRepository } from "./project.repository";

export class PrismaProjectRepository implements ProjectRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async getById(id: string): Promise<Project | null> {
    return this.prisma.project.findUnique({ where: { id } });
  }
}
