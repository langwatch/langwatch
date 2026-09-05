/**
 * The stored-objects table as its readers see it: seven operations over
 * content-addressed rows, every one scoped to a project first.
 */
import type { StoredObject } from "./stored-objects.row";

export abstract class StoredObjectsRepository {
  /** Inserts a single stored_objects row. */
  abstract insert(params: { projectId: string; row: StoredObject }): Promise<void>;

  abstract findById(params: { projectId: string; id: string }): Promise<StoredObject | null>;

  abstract findAllByProject(params: {
    projectId: string;
  }): Promise<Array<{ id: string; storage_uri: string }>>;

  /** A stable id-ordered page of the project's live rows. */
  abstract findLiveRowsByProjectPage(params: {
    projectId: string;
    afterId?: string;
    limit: number;
  }): Promise<StoredObject[]>;

  abstract sumSizeBytesByProject(params: {
    projectId: string;
    purpose?: string;
  }): Promise<{ totalBytes: number; objectCount: number }>;

  abstract deleteByProject(params: { projectId: string }): Promise<void>;

  abstract deleteByIds(params: { projectId: string; ids: string[] }): Promise<void>;
}
