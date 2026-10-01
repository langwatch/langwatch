import type { DataRetentionDirectoryReader } from "../app/data-retention.app.ts";
import type { DataRetentionRepository } from "./data-retention.repository.ts";
import type { PinnedTraceRepository } from "./pinned-trace.repository.ts";

export interface DataRetentionRepositories {
  readonly policies: DataRetentionRepository;
  readonly pins: PinnedTraceRepository;
  /** Which organization owns a scope, what it is called, what it resolves to. */
  readonly directory: DataRetentionDirectoryReader;
}
