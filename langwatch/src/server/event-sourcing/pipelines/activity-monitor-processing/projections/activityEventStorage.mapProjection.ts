import { AbstractMapProjection, type MapEventHandlers } from "../../../projections/abstractMapProjection";
import type { AppendStore } from "../../../projections/mapProjection.types";

import {
  activityEventReceivedEventSchema,
  type ActivityEventReceivedEvent,
} from "../schemas/events";

/**
 * Record type matching the gateway_activity_events ClickHouse table
 * (see migration 00019_create_gateway_activity_events.sql). Mirrors
 * the columns 1:1 — JSONEachRow upload friendly.
 */
export interface ClickHouseActivityEventRecord {
  TenantId: string;
  OrganizationId: string;
  SourceType: string;
  SourceId: string;
  EventId: string;
  EventType: string;
  Actor: string;
  Action: string;
  Target: string;
  CostUSD: string;
  TokensInput: number;
  TokensOutput: number;
  RawPayload: string;
  /** ClickHouse DateTime64(3) — "YYYY-MM-DD HH:MM:SS.mmm". */
  EventTimestamp: string;
}

const activityEvents = [activityEventReceivedEventSchema] as const;

const MAX_PAYLOAD_BYTES = 64 * 1024;

/**
 * Map projection for activity-monitor events. Translates each
 * ActivityEventReceived event into a ClickHouse row in
 * gateway_activity_events. Replaces the direct
 * `ActivityEventRepository.insert(...)` call from the receiver
 * handler — receivers now enqueue the command, the pipeline appends
 * the event to event_log, and this projection writes the row.
 */
export class ActivityEventStorageMapProjection
  extends AbstractMapProjection<ClickHouseActivityEventRecord, typeof activityEvents>
  implements MapEventHandlers<typeof activityEvents, ClickHouseActivityEventRecord>
{
  readonly name = "activityEventStorage";
  readonly store: AppendStore<ClickHouseActivityEventRecord>;
  protected readonly events = activityEvents;

  override options = {
    groupKeyFn: (event: { data: { sourceId: string; eventId: string } }) =>
      `activity:${event.data.sourceId}:${event.data.eventId}`,
  };

  constructor(deps: { store: AppendStore<ClickHouseActivityEventRecord> }) {
    super();
    this.store = deps.store;
  }

  mapActivityEventReceived(
    event: ActivityEventReceivedEvent,
  ): ClickHouseActivityEventRecord {
    const data = event.data;
    return {
      TenantId: data.sourceId,
      OrganizationId: data.organizationId,
      SourceType: data.sourceType,
      SourceId: data.sourceId,
      EventId: data.eventId,
      EventType: data.eventType,
      Actor: data.actor ?? "",
      Action: data.action ?? "",
      Target: data.target ?? "",
      CostUSD: data.costUsd ?? "0",
      TokensInput: data.tokensInput ?? 0,
      TokensOutput: data.tokensOutput ?? 0,
      RawPayload: truncatePayload(data.rawPayload ?? ""),
      EventTimestamp: msToClickhouseTime(data.eventTimestampMs),
    };
  }
}

function truncatePayload(payload: string): string {
  if (payload.length <= MAX_PAYLOAD_BYTES) return payload;
  return payload.slice(0, MAX_PAYLOAD_BYTES);
}

function msToClickhouseTime(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").replace("Z", "");
}
