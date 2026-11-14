import type { DatasetVersion, DatasetVersionRunLink } from "@langwatch/dataset-contract";
import { type Instant, nowInstant, toDate } from "@langwatch/time";

import {
  DatasetVersionNumberTakenError,
  type DatasetVersionRepository,
  type DatasetWithVersionHistory,
  type NewDatasetVersion,
} from "../dataset-version.repository.ts";

type StoredVersion = Omit<DatasetVersion, "runCount">;
type StoredRunLink = DatasetVersionRunLink & { projectId: string; experimentId: string | null };

/** The memory twin of the version tables; `now` lets a suite age the versions it writes. */
export class MemoryDatasetVersionRepository implements DatasetVersionRepository {
  readonly #versions: StoredVersion[] = [];
  readonly #runs: StoredRunLink[] = [];

  private constructor(private readonly now: () => Instant) {}

  static create(input: { now?: () => Instant } = {}): MemoryDatasetVersionRepository {
    return new MemoryDatasetVersionRepository(input.now ?? nowInstant);
  }

  async findLatest(input: {
    projectId: string;
    datasetId: string;
  }): Promise<DatasetVersion | null> {
    return (await this.findAll(input))[0] ?? null;
  }

  async findByNumber(input: {
    projectId: string;
    datasetId: string;
    version: number;
  }): Promise<DatasetVersion | null> {
    const found = this.#versions.find(
      (row) =>
        row.projectId === input.projectId &&
        row.datasetId === input.datasetId &&
        row.version === input.version,
    );
    return found ? this.#withRuns(found) : null;
  }

  async findAll(input: { projectId: string; datasetId: string }): Promise<DatasetVersion[]> {
    return this.#versions
      .filter((row) => row.projectId === input.projectId && row.datasetId === input.datasetId)
      .toSorted((left, right) => right.version - left.version)
      .map((row) => this.#withRuns(row));
  }

  async create(input: NewDatasetVersion): Promise<DatasetVersion> {
    const taken = this.#versions.some(
      (row) => row.datasetId === input.datasetId && row.version === input.version,
    );
    if (taken) throw new DatasetVersionNumberTakenError();
    const row: StoredVersion = { ...input, createdAt: toDate(this.now()) };
    this.#versions.push(row);
    return this.#withRuns(row);
  }

  async rename(input: { projectId: string; id: string; name: string }): Promise<DatasetVersion> {
    return this.#update(input, (row) => ({ ...row, name: input.name }));
  }

  async pin(input: { projectId: string; id: string }): Promise<DatasetVersion> {
    return this.#update(input, (row) => ({ ...row, pinned: true }));
  }

  async linkRun(input: {
    projectId: string;
    runId: string;
    experimentId: string | null;
    versions: readonly { datasetId: string; versionId: string }[];
  }): Promise<void> {
    for (const link of input.versions) {
      const exists = this.#runs.some(
        (row) =>
          row.projectId === input.projectId &&
          row.runId === input.runId &&
          row.datasetId === link.datasetId,
      );
      const version = this.#versions.find((row) => row.id === link.versionId);
      if (exists || !version) continue;
      this.#runs.push({
        projectId: input.projectId,
        runId: input.runId,
        experimentId: input.experimentId,
        datasetId: link.datasetId,
        versionId: link.versionId,
        version: version.version,
      });
    }
  }

  async findRunLinks(input: {
    projectId: string;
    runIds: readonly string[];
  }): Promise<DatasetVersionRunLink[]> {
    return this.#runs
      .filter((row) => row.projectId === input.projectId && input.runIds.includes(row.runId))
      .map(({ runId, datasetId, versionId, version }) => ({
        runId,
        datasetId,
        versionId,
        version,
      }));
  }

  async findDatasetsWithVersions(input: {
    afterDatasetId: string | null;
    olderThanMs: number;
    limit: number;
  }): Promise<DatasetWithVersionHistory[]> {
    const datasets = new Map<string, DatasetWithVersionHistory>();
    for (const row of this.#versions) {
      if (row.createdAt.getTime() >= input.olderThanMs) continue;
      if (input.afterDatasetId !== null && row.datasetId <= input.afterDatasetId) continue;
      datasets.set(`${row.projectId}/${row.datasetId}`, {
        projectId: row.projectId,
        datasetId: row.datasetId,
      });
    }
    return [...datasets.values()]
      .toSorted((left, right) => (left.datasetId < right.datasetId ? -1 : 1))
      .slice(0, input.limit);
  }

  async hasAny(input: { projectId: string; datasetId: string }): Promise<boolean> {
    return this.#versions.some(
      (row) => row.projectId === input.projectId && row.datasetId === input.datasetId,
    );
  }

  async forgetAuthor(input: { userId: string }): Promise<number> {
    let forgotten = 0;
    this.#versions.forEach((row, index) => {
      if (row.authorKind !== "user" || row.authorId !== input.userId) return;
      this.#versions[index] = { ...row, authorId: null };
      forgotten += 1;
    });
    return forgotten;
  }

  async deleteMany(input: { projectId: string; ids: readonly string[] }): Promise<number> {
    for (let index = this.#runs.length - 1; index >= 0; index--) {
      const link = this.#runs[index]!;
      if (link.projectId === input.projectId && input.ids.includes(link.versionId)) {
        this.#runs.splice(index, 1);
      }
    }
    let removed = 0;
    for (let index = this.#versions.length - 1; index >= 0; index--) {
      const row = this.#versions[index]!;
      if (row.projectId === input.projectId && input.ids.includes(row.id)) {
        this.#versions.splice(index, 1);
        removed += 1;
      }
    }
    return removed;
  }

  #withRuns(row: StoredVersion): DatasetVersion {
    const runCount = this.#runs.filter((link) => link.versionId === row.id).length;
    return { ...row, runCount };
  }

  #update(
    input: { projectId: string; id: string },
    change: (row: StoredVersion) => StoredVersion,
  ): DatasetVersion {
    const index = this.#versions.findIndex(
      (row) => row.projectId === input.projectId && row.id === input.id,
    );
    const row = this.#versions[index];
    if (!row) throw new Error(`Dataset version ${input.id} is not stored`);
    const updated = change(row);
    this.#versions[index] = updated;
    return this.#withRuns(updated);
  }
}
