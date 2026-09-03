import type { StoredObjectStore } from "../stores/stored-object.store";
import {
  PostgresStoredObjectStore,
  type StoredObjectDatabase,
} from "../stores/postgres/postgres.stored-object.store";

/** Process-composition adapter for the canonical store's Postgres persistence. */
export class PostgresStoredObjectAdapter {
  static create(database: StoredObjectDatabase): StoredObjectStore {
    return PostgresStoredObjectStore.create(database);
  }
}
