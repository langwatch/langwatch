import type { LwqlKeyMapRow } from "../features/provisioning/services/langwatch-ql-production-provisioning.service.ts";

/** The LangWatchQL key map: a project's key, written as a row and read back by tenant. */
export abstract class LwqlKeyMapRepository {
  abstract insertRow(input: { row: LwqlKeyMapRow; sourceDatabase: string }): Promise<void>;
  /** The key hashes the map holds for one tenant; empty when it holds none. */
  abstract findKeyHashes(input: { tenantId: string; sourceDatabase: string }): Promise<string[]>;
}
