/**
 * The legacy stored-objects index as its readers see it: one lookup, scoped to a project.
 */
import type { StoredObject } from "../rules/stored-object-row.rules.ts";

export abstract class StoredObjectsRepository {
  /** A function-typed property so tests can reference it unbound; no runtime difference. */
  abstract tryFindById: (params: { projectId: string; id: string }) => Promise<StoredObject | null>;
}
