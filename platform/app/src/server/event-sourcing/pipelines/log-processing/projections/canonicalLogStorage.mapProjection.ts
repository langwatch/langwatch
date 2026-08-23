import type { AppendStore } from "@langwatch/eventing";
import {
  AbstractMapProjection,
  type MapEventHandlers,
} from "@langwatch/eventing";
import { logCommandGroupKey } from "../canonicalLog";
import { LOG_MAP_COALESCE_MAX_BATCH } from "../schemas/constants";
import {
  type CanonicalLogRecordReceivedEvent,
  canonicalLogRecordReceivedEventSchema,
} from "../schemas/events";
import type { CanonicalLogRecord } from "../schemas/logRecord";

const events = [canonicalLogRecordReceivedEventSchema] as const;

export class CanonicalLogStorageMapProjection
  extends AbstractMapProjection<CanonicalLogRecord, typeof events>
  implements MapEventHandlers<typeof events, CanonicalLogRecord>
{
  readonly name = "canonicalLogStorage";
  readonly store: AppendStore<CanonicalLogRecord>;
  protected readonly events = events;

  constructor(deps: {
    store: AppendStore<CanonicalLogRecord>;
    shardCount: number;
  }) {
    super();
    this.store = deps.store;
    this.options = {
      groupKeyFn: (event: CanonicalLogRecordReceivedEvent) =>
        logCommandGroupKey(event.data.recordId, deps.shardCount),
      coalesceMaxBatch: LOG_MAP_COALESCE_MAX_BATCH,
    };
  }

  mapLogRecordReceived(
    event: CanonicalLogRecordReceivedEvent,
  ): CanonicalLogRecord {
    return event.data;
  }
}
