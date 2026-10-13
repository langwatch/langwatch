import {
  copyDatasetInputSchema,
  type CopyDatasetInput,
  type Dataset,
  type DatasetNameInput,
  type UpsertDatasetInput,
} from "@langwatch/dataset-contract";

import type { DatasetServiceOptions } from "./dataset.service.ts";

/** How many postgres-backed rows a copy moves at a time. */
const COPY_BATCH_ROWS = 200;

type DatasetCopyDeps = {
  options: DatasetServiceOptions;
  getBySlugOrId: (input: { projectId: string; slugOrId: string }) => Promise<Dataset>;
  findNextAvailableName: (input: DatasetNameInput) => Promise<string>;
  upsertDataset: (input: UpsertDatasetInput) => Promise<Dataset>;
  generateId: () => string;
};

/** Copies a dataset into a project under the next free name. */
export class DatasetCopyService {
  static create(deps: DatasetCopyDeps): DatasetCopyService {
    return new DatasetCopyService(deps);
  }

  private constructor(private readonly deps: DatasetCopyDeps) {}

  async copyDataset(input: CopyDatasetInput): Promise<Dataset> {
    const { options } = this.deps;
    const parsed = copyDatasetInputSchema.parse(input);
    const source = await this.deps.getBySlugOrId({
      projectId: parsed.sourceProjectId,
      slugOrId: parsed.sourceDatasetId,
    });
    const name = await this.deps.findNextAvailableName({
      projectId: parsed.targetProjectId,
      proposedName: source.name,
    });
    const target = await this.deps.upsertDataset({
      projectId: parsed.targetProjectId,
      name,
      columnTypes: source.columnTypes,
    });
    if (source.contentLayout === "s3_jsonl" && options.content) {
      // A new dataset starts inline; the content copy moves it to the chunk layout.
      await options.content.copyDataset({
        source,
        sourceProjectId: parsed.sourceProjectId,
        target,
        targetProjectId: parsed.targetProjectId,
      });

      return this.deps.getBySlugOrId({
        projectId: parsed.targetProjectId,
        slugOrId: target.id,
      });
    }

    // Every row, one batch in memory at a time.
    let cursorId: string | undefined;
    let copied = COPY_BATCH_ROWS;
    while (copied === COPY_BATCH_ROWS) {
      const batch = await options.records.findPage({
        datasetId: source.id,
        projectId: parsed.sourceProjectId,
        limit: COPY_BATCH_ROWS,
        cursorId,
      });
      if (batch.length > 0) {
        await options.records.createMany({
          datasetId: target.id,
          projectId: parsed.targetProjectId,
          entries: batch.map((record) => ({ id: this.deps.generateId(), ...record.entry })),
        });
      }
      copied = batch.length;
      cursorId = batch.at(-1)?.id;
    }

    return target;
  }
}
