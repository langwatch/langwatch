import {
  AbstractMapProjection,
  type MapEventHandlers,
} from "../../../projections/abstractMapProjection";
import type { AppendStore } from "../../../projections/mapProjection.types";
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
  override options = {
    groupKeyFn: (_event: CanonicalLogRecordReceivedEvent) => "tenant-batch",
    coalesceMaxBatch: LOG_MAP_COALESCE_MAX_BATCH,
  };

  constructor(deps: { store: AppendStore<CanonicalLogRecord> }) {
    super();
    this.store = deps.store;
  }

  mapLogRecordReceived(
    event: CanonicalLogRecordReceivedEvent,
  ): CanonicalLogRecord {
    return event.data;
  }
}
