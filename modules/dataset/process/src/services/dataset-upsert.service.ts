import {
  upsertDatasetInputSchema,
  DatasetNameTakenError,
  DatasetStaleColumnsError,
  type Dataset,
  type UpsertDatasetInput,
} from "@langwatch/dataset-contract";
import { ValidationError } from "@langwatch/handled-error";

import type { LockedDatasetRecords } from "../repositories/dataset-record.repository.ts";
import type { DatasetUpdateInput } from "../repositories/dataset.repository.ts";
import { mapPreviousColumnsToNewColumns } from "../rules/dataset-chunk-lines.rules.ts";
import { columnEditMovesValues, columnRenameProblems } from "../rules/dataset-columns.rules.ts";
import { onceMaxBytes } from "../rules/dataset-inline-file.rules.ts";
import { datasetSlugOf } from "../rules/dataset-selection.rules.ts";
import { isSingleFileDataset } from "../rules/dataset-single-file.rules.ts";
import type { DatasetServiceOptions } from "./dataset.service.ts";

type DatasetUpsertDeps = {
  options: DatasetServiceOptions;
  getBySlugOrId: (input: { projectId: string; slugOrId: string }) => Promise<Dataset>;
  assertReady: (dataset: Dataset) => void;
  generateId: () => string;
};

type ParsedUpsert = ReturnType<typeof upsertDatasetInputSchema.parse>;

const RECORD_PAGE_SIZE = 1000;

/** Creates a dataset, with its first records, or renames and retypes an existing one. */
export class DatasetUpsertService {
  static create(deps: DatasetUpsertDeps): DatasetUpsertService {
    return new DatasetUpsertService(deps);
  }

  private constructor(private readonly deps: DatasetUpsertDeps) {}

  async upsertDataset(input: UpsertDatasetInput): Promise<Dataset> {
    const parsed = upsertDatasetInputSchema.parse(input);
    const name = parsed.name.trim();
    if (parsed.datasetId) return this.update({ parsed, datasetId: parsed.datasetId, name });

    return this.create({ parsed, name });
  }

  private async update({
    parsed,
    datasetId,
    name,
  }: {
    parsed: ParsedUpsert;
    datasetId: string;
    name: string;
  }): Promise<Dataset> {
    const { options } = this.deps;
    const existing = await this.deps.getBySlugOrId({
      projectId: parsed.projectId,
      slugOrId: datasetId,
    });
    this.deps.assertReady(existing);
    await this.refuseRenameCollision({ projectId: parsed.projectId, dataset: existing, name });

    const update: DatasetUpdateInput = {
      id: existing.id,
      projectId: parsed.projectId,
      name,
      slug: existing.slug,
      columnTypes: parsed.columnTypes,
    };
    const columnsChanged =
      JSON.stringify(existing.columnTypes) !== JSON.stringify(parsed.columnTypes);
    const columnEdit = {
      previousColumns: existing.columnTypes,
      newColumns: parsed.columnTypes,
      renames: parsed.columnRenames,
    };
    const renameProblems = columnRenameProblems(columnEdit);
    if (renameProblems.length > 0) {
      throw new ValidationError(`Invalid column renames: ${renameProblems.join("; ")}.`, {
        fault: "customer",
        meta: { fieldErrors: { columnRenames: renameProblems } },
      });
    }
    const movesValues = columnEditMovesValues(columnEdit);
    const rewrites = columnsChanged || movesValues;
    if (existing.contentLayout === "s3_jsonl" && options.content && rewrites) {
      return options.content.updateColumns({
        dataset: existing,
        projectId: parsed.projectId,
        name,
        slug: existing.slug,
        columnTypes: parsed.columnTypes,
        ...(parsed.columnRenames ? { columnRenames: parsed.columnRenames } : {}),
      });
    }

    const lockedLayout =
      (isSingleFileDataset(existing) && options.singleFile !== undefined) ||
      existing.contentLayout === "postgres";
    if (rewrites && isSingleFileDataset(existing) && options.singleFile) {
      await options.singleFile.updateColumns({
        dataset: existing,
        columnTypes: parsed.columnTypes,
        columnRenames: parsed.columnRenames,
      });
    } else if (rewrites && existing.contentLayout === "postgres") {
      await this.migrateRecordColumns({ dataset: existing, parsed, movesValues });
    }
    // Unchanged columns, or columns stored under the lock: writing them could undo a later edit.
    const { columnTypes: _kept, ...named } = update;
    const writesColumns = columnsChanged && !lockedLayout;
    return options.repository.update(writesColumns ? update : named);
  }

  /**
   * Re-keys every Postgres record and stores the new columns in one transaction under the
   * dataset's lock, which record writes also take, so no write lands between the two.
   */
  private async migrateRecordColumns({
    dataset,
    parsed,
    movesValues,
  }: {
    dataset: Dataset;
    parsed: ParsedUpsert;
    /** False for a type change, reorder or addition: the columns change, no record does. */
    movesValues: boolean;
  }): Promise<void> {
    const key = { datasetId: dataset.id, projectId: dataset.projectId };
    await this.deps.options.records.withDatasetLock(key, async (records) => {
      const current = await records.columnTypes();
      if (JSON.stringify(current) !== JSON.stringify(dataset.columnTypes)) {
        throw new DatasetStaleColumnsError();
      }
      if (movesValues) await this.rekeyRecords({ records, dataset, parsed });
      await records.setColumnTypes(parsed.columnTypes);
    });
  }

  private async rekeyRecords({
    records,
    dataset,
    parsed,
  }: {
    records: LockedDatasetRecords;
    dataset: Dataset;
    parsed: ParsedUpsert;
  }): Promise<void> {
    const key = { datasetId: dataset.id, projectId: dataset.projectId };
    const stored: Awaited<ReturnType<typeof records.findPage>> = [];
    let page = await records.findPage({ ...key, limit: RECORD_PAGE_SIZE });
    stored.push(...page);
    while (page.length === RECORD_PAGE_SIZE) {
      const cursorId = page.at(-1)!.id;
      page = await records.findPage({ ...key, limit: RECORD_PAGE_SIZE, cursorId });
      stored.push(...page);
    }
    const remapped = mapPreviousColumnsToNewColumns({
      records: stored.map((record) => record.entry),
      previousColumns: dataset.columnTypes,
      newColumns: parsed.columnTypes,
      renames: parsed.columnRenames,
    });
    if (stored.length > 0) {
      await records.replaceAll({
        ...key,
        entries: stored.map((record, index) => ({ ...remapped[index], id: record.id })),
      });
    }
  }

  private async create({ parsed, name }: { parsed: ParsedUpsert; name: string }): Promise<Dataset> {
    const { options } = this.deps;
    const slug = datasetSlugOf(name);
    const conflict = await options.repository.findBySlug({ projectId: parsed.projectId, slug });
    if (conflict) {
      throw new DatasetNameTakenError();
    }

    if (parsed.datasetRecords && parsed.datasetRecords.length > 0) {
      const maxBytes = onceMaxBytes(() =>
        options.requestBounds.limit(parsed.projectId, "attachmentBytes"),
      );
      parsed.datasetRecords = await options.inlineAttachments.storeAll(
        {
          projectId: parsed.projectId,
          columns: { kind: "typed", columnTypes: parsed.columnTypes },
          maxBytes,
        },
        parsed.datasetRecords,
      );
      await options.attachments.assertAccepted({
        projectId: parsed.projectId,
        columnTypes: parsed.columnTypes,
        entries: parsed.datasetRecords,
        maxBytes,
      });
    }

    const created = await options.repository.create({
      projectId: parsed.projectId,
      name,
      slug,
      columnTypes: parsed.columnTypes,
    });
    if (parsed.datasetRecords && parsed.datasetRecords.length > 0) {
      await options.records.createMany({
        datasetId: created.id,
        projectId: parsed.projectId,
        entries: parsed.datasetRecords.map((entry) => ({
          ...entry,
          id: entry.id ?? this.deps.generateId(),
        })),
      });
    }

    return created;
  }

  /**
   * A rename keeps the slug (SDK and API callers address the dataset by it), but a
   * new name whose slug another dataset already holds is still refused.
   * See specs/datasets/dataset-slug-stability.feature.
   */
  private async refuseRenameCollision(input: {
    projectId: string;
    dataset: Dataset;
    name: string;
  }): Promise<void> {
    if (input.name === input.dataset.name) return;
    const conflict = await this.deps.options.repository.findBySlug({
      projectId: input.projectId,
      slug: datasetSlugOf(input.name),
      excludeId: input.dataset.id,
    });
    if (conflict) {
      throw new DatasetNameTakenError();
    }
  }
}
