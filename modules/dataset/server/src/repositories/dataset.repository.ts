import type { Dataset, DatasetColumns, DatasetSummary } from "@langwatch/dataset-contract";
import type { Instant } from "@langwatch/time";

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
