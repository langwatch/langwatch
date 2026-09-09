import type { DataRetentionRepository } from "./data-retention.repository.ts";
import type { PinnedTraceRepository } from "./pinned-trace.repository.ts";

export interface DataRetentionRepositories {
  readonly policies: DataRetentionRepository;
  readonly pins: PinnedTraceRepository;
}
