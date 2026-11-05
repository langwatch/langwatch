import {
  copyDatasetInputSchema,
  type CopyDatasetInput,
  type Dataset,
  type DatasetNameInput,
  type UpsertDatasetInput,
} from "@langwatch/dataset-contract";

import type { DatasetContent, DatasetSeedRow } from "../app/dataset.app.ts";
import { isSingleFileDataset } from "../rules/dataset-single-file.rules.ts";
import type { DatasetServiceOptions } from "./dataset.service.ts";

/** How many postgres-backed rows a copy moves at a time. */
const COPY_BATCH_ROWS = 200;

type DatasetCopyDeps = {
  options: DatasetServiceOptions;
  getBySlugOrId: (input: { projectId: string; slugOrId: string }) => Promise<Dataset>;
  findNextAvailableName: (input: DatasetNameInput) => Promise<string>;
  upsertDataset: (input: UpsertDatasetInput) => Promise<Dataset>;
  createWithStoredRows: (input: {
    content: DatasetContent;
    projectId: string;
    name: string;
    columnTypes: Dataset["columnTypes"];
    rows: AsyncIterable<DatasetSeedRow>;
  }) => Promise<Dataset>;
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
    const sourceKey = { source, projectId: parsed.sourceProjectId };
    if (options.content && source.contentLayout !== "s3_jsonl") {
      return this.deps.createWithStoredRows({
        content: options.content,
        projectId: parsed.targetProjectId,
        name,
        columnTypes: source.columnTypes,
        rows: this.sourceRows(sourceKey),
      });
    }

    const target = await this.deps.upsertDataset({
      projectId: parsed.targetProjectId,
      name,
      columnTypes: source.columnTypes,
    });
    if (source.contentLayout === "s3_jsonl" && options.content) {
      // The new dataset is born empty in object storage; the content copy fills its chunks.
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

    // No object storage composed (a unit test): the copy's rows go to the records table.
    let batch: DatasetSeedRow["entry"][] = [];
    const flush = async () => {
      if (batch.length === 0) return;
      await options.records.createMany({
        datasetId: target.id,
        projectId: parsed.targetProjectId,
        entries: batch.map((entry) => ({ id: this.deps.generateId(), ...entry })),
      });
      batch = [];
    };
    for await (const row of this.sourceRows(sourceKey)) {
      batch.push(row.entry);
      if (batch.length === COPY_BATCH_ROWS) await flush();
    }
    await flush();

    return target;
  }

  /** Every row of a Postgres or single-file source, one batch in memory at a time. */
  private async *sourceRows({
    source,
    projectId,
  }: {
    source: Dataset;
    projectId: string;
  }): AsyncGenerator<DatasetSeedRow> {
    const { options } = this.deps;
    if (isSingleFileDataset(source) && options.singleFile) {
      for (const entry of await options.singleFile.findAllEntries({ dataset: source })) {
        yield { entry };
      }
      return;
    }

    let cursorId: string | undefined;
    let page: Awaited<ReturnType<typeof options.records.findPage>>;
    do {
      page = await options.records.findPage({
        datasetId: source.id,
        projectId,
        limit: COPY_BATCH_ROWS,
        cursorId,
      });
      for (const record of page) yield { entry: record.entry };
      cursorId = page.at(-1)?.id;
    } while (page.length === COPY_BATCH_ROWS);
  }
}
