import { isSingleFileDataset } from "../../rules/dataset-single-file.rules.ts";
import type { DatasetSingleFileConversionRepository } from "../dataset-single-file-conversion.repository.ts";
import type { MemoryDatasetDatabase } from "./memory.dataset.database.ts";

/** The conversion's selection over the memory twin's rows, by the same rule as Postgres. */
export class MemoryDatasetSingleFileConversionRepository implements DatasetSingleFileConversionRepository {
  #database: MemoryDatasetDatabase;

  private constructor(database: MemoryDatasetDatabase) {
    this.#database = database;
  }

  static create(input: Readonly<{ database: MemoryDatasetDatabase }>) {
    return new MemoryDatasetSingleFileConversionRepository(input.database);
  }

  async findSingleFileDatasetIds(input: {
    projectId: string;
    afterId?: string | undefined;
    limit: number;
  }): Promise<string[]> {
    return this.#database
      .datasets()
      .filter((row) => row.projectId === input.projectId && isSingleFileDataset(row))
      .map((row) => row.id)
      .filter((id) => input.afterId === undefined || id > input.afterId)
      .toSorted()
      .slice(0, input.limit);
  }
}
