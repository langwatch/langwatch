import type { Dataset, DatasetColumns, DatasetSummary } from "@langwatch/dataset-contract";
import type { Instant } from "@langwatch/time";

/**
 * A dataset row as its storage returns it.
 *
 * The scalar columns only - deliberately not the parsed `Dataset` the contract
 * publishes, because the upload path reads `columnTypes` raw in some places and
 * parses it in others, and moving that parse into the repository would newly
 * throw on the retry and cancel paths for a row those paths never look inside.
 * This states the shape without changing when anything is validated.
 */
export type DatasetRow = Pick<Dataset, "createdAt" | "updatedAt" | "archivedAt"> & {
  id: string;
  projectId: string;
  name: string;
  slug: string;
  columnTypes: unknown;
  mapping: unknown;
  useS3: boolean;
  s3RecordCount: number | null;
  contentLayout: string;
  status: string;
  statusError: string | null;
  stagingKey: string | null;
  uploadFilename: string | null;
  rowCount: number | null;
  sizeBytes: bigint | null;
  chunkCount: number | null;
  chunkOffsets: unknown;
};

export type DatasetCreateInput = {
  projectId: string;
  name: string;
  slug: string;
  columnTypes: DatasetColumns;
};

export type DatasetUpdateInput = {
  id: string;
  projectId: string;
  name: string;
  slug: string;
  columnTypes: DatasetColumns;
};

export interface DatasetRepository {
  findById(input: {
    id: string;
    projectId: string;
    includeArchived?: boolean;
  }): Promise<Dataset | null>;
  findBySlug(input: {
    slug: string;
    projectId: string;
    excludeId?: string;
    includeArchived?: boolean;
  }): Promise<Dataset | null>;
  list(input: { projectId: string; page: number; limit: number }): Promise<DatasetSummary[]>;
  create(input: DatasetCreateInput): Promise<Dataset>;
  update(input: DatasetUpdateInput): Promise<Dataset>;
  archive(input: {
    id: string;
    projectId: string;
    slug: string;
    archivedAt: Instant | null;
  }): Promise<Dataset>;
  restore(input: { id: string; projectId: string; slug: string }): Promise<Dataset>;
  updateMapping(input: {
    id: string;
    projectId: string;
    mapping: Record<string, unknown>;
  }): Promise<Dataset>;
  count(input: { projectId: string; slug: string }): Promise<number>;
}
