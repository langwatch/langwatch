import type { Project } from "@prisma/client";

export interface ProjectRepository {
  getById(id: string): Promise<Project | null>;
}

export class NullProjectRepository implements ProjectRepository {
  async getById(_id: string): Promise<Project | null> {
    return null;
  }
}
