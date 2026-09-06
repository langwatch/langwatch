import type { StoredObjectStore } from "../stores/stored-object.store.ts";
import {
  PostgresStoredObjectStore,
  type StoredObjectDatabase,
} from "../stores/postgres/postgres.stored-object.store.ts";

/** Process-composition adapter for the canonical store's Postgres persistence. */
export class PostgresStoredObjectAdapter {
  static create(database: StoredObjectDatabase): StoredObjectStore {
    return PostgresStoredObjectStore.create(database);
  }
}
