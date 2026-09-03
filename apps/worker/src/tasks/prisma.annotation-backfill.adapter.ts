import type { PrismaClient } from "@langwatch/prisma-client/generated";
import {
  AnnotationBackfillSourcePort,
  type BackfillableAnnotation,
} from "./backfill-annotations-to-clickhouse.task";

/**
 * The annotations of record, read through the process's guarded client.
 *
 * Each read names its project, which is what the multitenancy guard requires
 * and what makes the project list the first thing this adapter answers rather
 * than a detail of the sweep above it.
 */
export class PrismaAnnotationBackfillAdapter extends AnnotationBackfillSourcePort {
  private constructor(private readonly prisma: PrismaClient) {
    super();
  }

  static create({ prisma }: { prisma: PrismaClient }): PrismaAnnotationBackfillAdapter {
    return new PrismaAnnotationBackfillAdapter(prisma);
  }

  async listProjectIds(): Promise<readonly string[]> {
    const projects = await this.prisma.project.findMany({ select: { id: true } });
    return projects.map((project) => project.id);
  }

  async listAnnotations({
    projectId,
  }: {
    projectId: string;
  }): Promise<readonly BackfillableAnnotation[]> {
    return await this.prisma.annotation.findMany({
      where: { projectId },
      select: { id: true, traceId: true },
    });
  }
}
