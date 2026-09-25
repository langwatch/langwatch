import {
  type AppendStore,
  AbstractMapProjection,
  type MapEventHandlers,
} from "@langwatch/eventing";
import {
  LOG_MAP_COALESCE_MAX_BATCH,
  type CanonicalLogRecordReceivedEvent,
  canonicalLogRecordReceivedEventSchema,
  type CanonicalLogRecord,
} from "@langwatch/log-contract";

import { CanonicalLogService } from "../services/canonical-log.service.ts";

const events = [canonicalLogRecordReceivedEventSchema] as const;

export class CanonicalLogStorageMapProjection
  extends AbstractMapProjection<CanonicalLogRecord, typeof events>
  implements MapEventHandlers<typeof events, CanonicalLogRecord>
{
  static create(deps: {
    store: AppendStore<CanonicalLogRecord>;
    shardCount: number;
  }): CanonicalLogStorageMapProjection {
    return new CanonicalLogStorageMapProjection(deps);
  }

  readonly name = "canonicalLogStorage";
  readonly store: AppendStore<CanonicalLogRecord>;
  protected readonly events = events;

  private constructor(deps: { store: AppendStore<CanonicalLogRecord>; shardCount: number }) {
    super();
    this.store = deps.store;
    this.options = {
      groupKeyFn: (event: CanonicalLogRecordReceivedEvent) =>
        CanonicalLogService.logCommandGroupKey(event.data.recordId, deps.shardCount),
      coalesceMaxBatch: LOG_MAP_COALESCE_MAX_BATCH,
    };
  }

  mapLogRecordReceived(event: CanonicalLogRecordReceivedEvent): CanonicalLogRecord {
    return event.data;
  }
}
