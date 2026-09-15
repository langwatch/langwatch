import type { SavedView, SavedViewJson } from "@langwatch/dashboard-contract";

/** A saved view as the repository hands it back, and as tRPC ships it. */
export type SavedViewRecord = SavedView;

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
   * Storage shape discriminator. Omit to keep the SavedView default
   * ("v1-traces-filter"), which is what the v1 filter bar writes. The traces v2
   * lens system sends "v2-traces-lens" so the two clients can share this table
   * without seeing each other's rows.
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
export interface SavedViewRepository {
  findAll(input: { projectId: string; userId?: string; kind?: string }): Promise<SavedViewRecord[]>;
  findById(input: { id: string; projectId: string }): Promise<SavedViewRecord | undefined>;
  findLast(input: { projectId: string; kind?: string }): Promise<SavedViewRecord | undefined>;
  /** The ownership of each named view, so the caller can tell a shared one from a personal one. */
  findByIds(input: {
    ids: string[];
    projectId: string;
  }): Promise<Array<{ id: string; userId: string | null }>>;
  create(input: CreateSavedViewInput): Promise<SavedViewRecord>;
  createMany(input: { views: CreateSavedViewInput[] }): Promise<void>;
  update(input: UpdateSavedViewInput): Promise<SavedViewRecord>;
  delete(input: { id: string; projectId: string }): Promise<SavedViewRecord>;
  updateOrder(input: { projectId: string; viewIds: string[] }): Promise<void>;
  count(input: { projectId: string; userId?: string; kind?: string }): Promise<number>;
}
