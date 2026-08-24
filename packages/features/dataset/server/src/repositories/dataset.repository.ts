import type {
  Dataset,
  DatasetColumns,
  DatasetSummary,
} from "@langwatch/dataset-contract";

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

export abstract class DatasetRepository {
  abstract tryFindById(input: {
    id: string;
    projectId: string;
    includeArchived?: boolean;
  }): Promise<Dataset | null>;
  abstract tryFindBySlug(input: {
    slug: string;
    projectId: string;
    excludeId?: string;
    includeArchived?: boolean;
  }): Promise<Dataset | null>;
  abstract list(input: {
    projectId: string;
    page: number;
    limit: number;
  }): Promise<DatasetSummary[]>;
  abstract create(input: DatasetCreateInput): Promise<Dataset>;
  abstract update(input: DatasetUpdateInput): Promise<Dataset>;
  abstract archive(input: {
    id: string;
    projectId: string;
    slug: string;
    archivedAt: Date | null;
  }): Promise<Dataset>;
  abstract restore(input: { id: string; projectId: string; slug: string }): Promise<Dataset>;
  abstract updateMapping(input: {
    id: string;
    projectId: string;
    mapping: Record<string, unknown>;
  }): Promise<Dataset>;
  abstract count(input: { projectId: string; slug: string }): Promise<number>;
}
