import type { StoredObject } from "../../rules/stored-object-row.rules.ts";
import { StoredObjectsRepository } from "../stored-objects.repository.ts";

/**
 * The legacy ClickHouse index's memory twin. Nothing writes the index, so with
 * no ClickHouse in this tier every lookup answers "no such row".
 */
export class MemoryStoredObjectsRepository extends StoredObjectsRepository {
  static create(): MemoryStoredObjectsRepository {
    return new MemoryStoredObjectsRepository();
  }

  private constructor() {
    super();
  }

  tryFindById = (_params: { projectId: string; id: string }): Promise<StoredObject | null> =>
    Promise.resolve(null);
}
