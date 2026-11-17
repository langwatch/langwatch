import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type { DatasetSingleFileConversionRepository } from "../dataset-single-file-conversion.repository.ts";

/** Only what the selection reads, so composition names the slice it needs. */
type DatasetSingleFileConversionDatabase = Pick<PrismaClient, "dataset">;

export class PrismaDatasetSingleFileConversionRepository implements DatasetSingleFileConversionRepository {
  static create(options: { database: DatasetSingleFileConversionDatabase }) {
    return new PrismaDatasetSingleFileConversionRepository(options.database);
  }

  private constructor(private readonly database: DatasetSingleFileConversionDatabase) {}

  async findSingleFileDatasetIds(input: {
    projectId: string;
    afterId?: string | undefined;
    limit: number;
  }): Promise<string[]> {
    const page = await this.database.dataset.findMany({
      where: {
        projectId: input.projectId,
        contentLayout: "postgres",
        useS3: true,
        ...(input.afterId ? { id: { gt: input.afterId } } : {}),
      },
      select: { id: true },
      orderBy: { id: "asc" },
      take: input.limit,
    });
    return page.map((dataset) => dataset.id);
  }
}
