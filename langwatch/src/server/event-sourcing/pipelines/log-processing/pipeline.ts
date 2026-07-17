import { definePipeline } from "../..";
import type { AppendStore } from "../../projections/mapProjection.types";
import { logCommandGroupKey } from "./canonicalLog";
import { RecordCanonicalLogCommand } from "./commands/recordCanonicalLogCommand";
import { CanonicalLogStorageMapProjection } from "./projections/canonicalLogStorage.mapProjection";
import type { LogProcessingEvent } from "./schemas/events";
import type { CanonicalLogRecord } from "./schemas/logRecord";

export interface LogProcessingPipelineDeps {
  canonicalLogAppendStore: AppendStore<CanonicalLogRecord>;
  logCommandShardCount: number;
}

export function createLogProcessingPipeline(deps: LogProcessingPipelineDeps) {
  return definePipeline<LogProcessingEvent>()
    .withName("log_processing")
    .withAggregateType("log")
    .withMapProjection(
      "canonicalLogStorage",
      new CanonicalLogStorageMapProjection({
        store: deps.canonicalLogAppendStore,
      }),
    )
    .withCommand("recordLogRecord", RecordCanonicalLogCommand, {
      getGroupKey: (payload) =>
        logCommandGroupKey(payload.recordId, deps.logCommandShardCount),
    })
    .build();
}
