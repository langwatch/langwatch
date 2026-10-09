import type { PrismaClient } from "~/generated/prisma/client";

/**
 * A project's kind by id: the read the aggregate admin gate makes, cached
 * behind the App's `projectKinds` reader (ADR-144). Kept apart from the full project repository
 * so the permission adapters can read a kind without pulling that
 * repository's grants-ledger writer onto their import graph.
 */
export interface ProjectKindRepository {
  /** The project's kind, or null when no project has this id. */
  findKindById(id: string): Promise<string | null>;
  /** Many projects' kinds in one read; an unknown id is absent. */
  findKindsByIds(ids: readonly string[]): Promise<Map<string, string>>;
}

export class PrismaProjectKindRepository implements ProjectKindRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findKindById(id: string): Promise<string | null> {
    const project = await this.prisma.project.findUnique({
      where: { id },
      select: { kind: true },
    });
    return project?.kind ?? null;
  }

  async findKindsByIds(ids: readonly string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const projects = await this.prisma.project.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, kind: true },
    });
    return new Map(projects.map(({ id, kind }) => [id, kind]));
  }
}
