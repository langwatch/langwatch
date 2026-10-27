import { createTenantId, type EventReadSeat } from "@langwatch/eventing";
import {
  CONNECTION_IDP_UPDATED_EVENT_TYPE,
  SSO_CONNECTION_AGGREGATE_TYPE,
  SSO_CONNECTION_EVENT_TYPES,
  type SsoConnectionSource,
  ssoConnectionSourceSchema,
} from "@langwatch/identity-contract";

import type { SsoConnectionEvent } from "../../eventing/sso-connection-state.projection.ts";
import {
  SsoConnectionHistoryRepository,
  type SsoConnectionHistoryEntry,
} from "../sso-connection-history.repository.ts";

/** Fields the connection payloads carry, read structurally rather than parsed
 *  per type — the reader wants the same handful of columns off every fact. */
interface SsoConnectionPayloadShape {
  domain?: unknown;
  method?: unknown;
  route?: unknown;
  policy?: unknown;
  name?: unknown;
  idp?: { issuer?: unknown };
  note?: unknown;
  reason?: unknown;
  replacesConnectionId?: unknown;
  source?: unknown;
}

/** The one read this repository takes: one connection's sso_connection stream. */
type SsoConnectionEventReads = Pick<EventReadSeat, "findAggregateEvents">;

const SSO_CONNECTION_EVENT_TYPE_SET: ReadonlySet<unknown> = new Set(SSO_CONNECTION_EVENT_TYPES);

type SsoConnectionHistoryTextFields = Omit<
  SsoConnectionHistoryEntry,
  "eventId" | "type" | "occurredAtMs" | "source"
>;

/** Every payload carries `source`; the fallback is only ever reached by a
 *  malformed fixture, never by production data. */
function sourceOf(value: unknown): SsoConnectionSource {
  const parsed = ssoConnectionSourceSchema.safeParse(value);
  return parsed.success ? parsed.data : "self-serve";
}

/**
 * The connection log itself, read through eventing's read seat so a producer-only api answers it
 * too (WEB-9103). The events ARE the panel: rebuildable for free, nothing the log cannot re-derive.
 */
export class EventingSsoConnectionHistoryRepository extends SsoConnectionHistoryRepository {
  static create(deps: {
    eventReadSeat: SsoConnectionEventReads;
  }): EventingSsoConnectionHistoryRepository {
    return new EventingSsoConnectionHistoryRepository(deps.eventReadSeat);
  }

  private constructor(private readonly eventReadSeat: SsoConnectionEventReads) {
    super();
  }

  async findHistory({
    organizationId,
    connectionId,
    limit,
  }: {
    organizationId: string;
    connectionId: string;
    limit: number;
  }): Promise<readonly SsoConnectionHistoryEntry[]> {
    const events = await this.eventReadSeat.findAggregateEvents({
      tenantId: createTenantId(organizationId),
      aggregateType: SSO_CONNECTION_AGGREGATE_TYPE,
      aggregateId: connectionId,
    });
    return events
      .filter(isSsoConnectionEvent)
      .map(toHistoryEntry)
      .toSorted(newestFirst)
      .slice(0, limit);
  }
}

/** One of the facts the sso_connection pipeline declares. */
function isSsoConnectionEvent(event: unknown): event is SsoConnectionEvent {
  return (
    typeof event === "object" &&
    event !== null &&
    "type" in event &&
    SSO_CONNECTION_EVENT_TYPE_SET.has(event.type)
  );
}

function toHistoryEntry(event: SsoConnectionEvent): SsoConnectionHistoryEntry {
  const data: SsoConnectionPayloadShape = event.data;
  return {
    eventId: event.id,
    type: event.type,
    occurredAtMs: event.occurredAt,
    source: sourceOf(data.source),
    ...textFieldsOf({ data, type: event.type }),
  };
}

/** The prose fields, read off one payload. Every one is optional on the
 *  wire, so an absent or empty string is the same answer: nothing said. */
function textFieldsOf({
  data,
  type,
}: {
  data: SsoConnectionPayloadShape;
  type: string;
}): SsoConnectionHistoryTextFields {
  const read = (value: unknown): string | null =>
    typeof value === "string" && value.length > 0 ? value : null;
  return {
    domain: read(data.domain),
    method: read(data.method),
    route: read(data.route),
    policy: read(data.policy),
    name: read(data.name),
    // Only an identity provider change names the issuer in its line.
    issuer: type === CONNECTION_IDP_UPDATED_EVENT_TYPE ? read(data.idp?.issuer) : null,
    note: read(data.note) ?? read(data.reason),
    replacesConnectionId: read(data.replacesConnectionId),
  };
}

/** Newest first, with the event id breaking a tie so every pod agrees. */
function newestFirst(a: SsoConnectionHistoryEntry, b: SsoConnectionHistoryEntry): number {
  if (b.occurredAtMs !== a.occurredAtMs) return b.occurredAtMs - a.occurredAtMs;
  return b.eventId.localeCompare(a.eventId);
}
