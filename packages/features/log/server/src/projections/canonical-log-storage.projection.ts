import type { AppendStore } from "@langwatch/eventing";
import { AbstractMapProjection, type MapEventHandlers } from "@langwatch/eventing";
import { logCommandGroupKey } from "../adapters/canonical-log.adapter";
import { LOG_MAP_COALESCE_MAX_BATCH } from "@langwatch/log-contract";
import {
  type CanonicalLogRecordReceivedEvent,
  canonicalLogRecordReceivedEventSchema,
} from "@langwatch/log-contract";
import type { CanonicalLogRecord } from "@langwatch/log-contract";

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
        logCommandGroupKey(event.data.recordId, deps.shardCount),
      coalesceMaxBatch: LOG_MAP_COALESCE_MAX_BATCH,
    };
  }

  mapLogRecordReceived(event: CanonicalLogRecordReceivedEvent): CanonicalLogRecord {
    return event.data;
  }
}
