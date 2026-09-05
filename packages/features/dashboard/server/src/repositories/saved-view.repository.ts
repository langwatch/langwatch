import type { SavedViewJson, SavedViewRecord } from "../ports/dashboard.port";

/**
 * Input types for saved view operations.
 */
export type CreateSavedViewInput = {
  id: string;
  projectId: string;
  userId?: string;
  name: string;
  filters: SavedViewJson;
  query?: string;
  period?: SavedViewJson;
  order: number;
  /**
   * Storage shape discriminator. Omit to keep the SavedView default ("v1-traces-filter"), which
   * is what the v1 filter bar writes. The traces v2 lens system sends "v2-traces-lens" so the
   * two clients can share this table without seeing each other's rows.
   */
  kind?: string;
};

/** The fields a saved view may be edited through, in portable terms. */
export type SavedViewUpdate = {
  name?: string;
  filters?: SavedViewJson;
  query?: string | null;
  period?: SavedViewJson | null;
  order?: number;
  kind?: string;
};

export type UpdateSavedViewInput = {
  id: string;
  projectId: string;
  data: SavedViewUpdate;
};

/**
 * The saved-view reads and writes, in portable terms.
 *
 * CRITICAL: Every query includes projectId for multitenancy protection.
 */
export abstract class SavedViewRepository {
  abstract findAll(input: {
    projectId: string;
    userId?: string;
    kind?: string;
  }): Promise<SavedViewRecord[]>;
  abstract tryFindById(input: { id: string; projectId: string }): Promise<SavedViewRecord | null>;
  abstract tryFindLast(input: {
    projectId: string;
    kind?: string;
  }): Promise<SavedViewRecord | null>;
  abstract findByIds(input: { ids: string[]; projectId: string }): Promise<Array<{ id: string }>>;
  abstract create(input: CreateSavedViewInput): Promise<SavedViewRecord>;
  abstract createMany(input: { views: CreateSavedViewInput[] }): Promise<void>;
  abstract update(input: UpdateSavedViewInput): Promise<SavedViewRecord>;
  abstract delete(input: { id: string; projectId: string }): Promise<SavedViewRecord>;
  abstract updateOrder(input: { projectId: string; viewIds: string[] }): Promise<void>;
  abstract count(input: { projectId: string; userId?: string; kind?: string }): Promise<number>;
}
