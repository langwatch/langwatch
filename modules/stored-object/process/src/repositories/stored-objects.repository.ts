/**
 * The stored-objects table as its readers see it: five operations over
 * content-addressed rows, every one scoped to a project first.
 */
import type { StoredObject } from "../rules/stored-object-row.rules.ts";

export abstract class StoredObjectsRepository {
  /**
   * Inserts one stored_objects row. A function-typed property rather than method shorthand, so
   * tests can reference members unbound without `typescript/unbound-method`; no runtime difference.
   */
  abstract insert: (params: { projectId: string; row: StoredObject }) => Promise<void>;

  abstract tryFindById: (params: { projectId: string; id: string }) => Promise<StoredObject | null>;

  abstract findAllByProject: (params: {
    projectId: string;
  }) => Promise<{ id: string; storage_uri: string }[]>;

  abstract sumSizeBytesByProject(params: {
    projectId: string;
    purpose?: string;
  }): Promise<{ totalBytes: number; objectCount: number }>;

  abstract deleteByIds: (params: { projectId: string; ids: string[] }) => Promise<void>;
}
