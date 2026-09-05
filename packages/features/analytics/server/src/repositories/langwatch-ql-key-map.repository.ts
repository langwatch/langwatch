import type { LwqlKeyMapRow } from "../services/langwatch-ql-production-provisioning.service";

/** The one write the LangWatchQL key map takes: a project's key, as a row. */
export abstract class LwqlKeyMapRepository {
  abstract insertRow(input: { table: string; row: LwqlKeyMapRow }): Promise<void>;
}
