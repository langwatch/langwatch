import { type EventStore, createTenantId } from "@langwatch/eventing";
import {
  SSO_CONNECTION_AGGREGATE_TYPE,
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
  note?: unknown;
  reason?: unknown;
  replacesConnectionId?: unknown;
  source?: unknown;
}

/** The one read this repository takes off the store — narrowed so a caller
 *  hands what it uses rather than a whole store it does not. */
export type SsoConnectionEventReads = Pick<EventStore<SsoConnectionEvent>, "getEvents">;

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
 * The connection log itself, read through this process's event store. The
 * events ARE the panel, so the panel is rebuildable for free and shows
 * nothing the log cannot re-derive.
 */
export class EventingSsoConnectionHistoryRepository extends SsoConnectionHistoryRepository {
  static create(deps: {
    eventStore: () => Promise<SsoConnectionEventReads>;
  }): EventingSsoConnectionHistoryRepository {
    return new EventingSsoConnectionHistoryRepository(deps.eventStore);
  }

  private constructor(private readonly eventStore: () => Promise<SsoConnectionEventReads>) {
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
    const store = await this.eventStore();
    const events = await store.getEvents(
      connectionId,
      { tenantId: createTenantId(organizationId) },
      SSO_CONNECTION_AGGREGATE_TYPE,
    );
    return events.map(toHistoryEntry).toSorted(newestFirst).slice(0, limit);
  }
}

function toHistoryEntry(event: SsoConnectionEvent): SsoConnectionHistoryEntry {
  const data: SsoConnectionPayloadShape = event.data;
  return {
    eventId: event.id,
    type: event.type,
    occurredAtMs: event.occurredAt,
    source: sourceOf(data.source),
    ...textFieldsOf(data),
  };
}

/** The prose fields, read off one payload. Every one is optional on the
 *  wire, so an absent or empty string is the same answer: nothing said. */
function textFieldsOf(data: SsoConnectionPayloadShape): SsoConnectionHistoryTextFields {
  const read = (value: unknown): string | null =>
    typeof value === "string" && value.length > 0 ? value : null;
  return {
    domain: read(data.domain),
    method: read(data.method),
    route: read(data.route),
    policy: read(data.policy),
    name: read(data.name),
    note: read(data.note) ?? read(data.reason),
    replacesConnectionId: read(data.replacesConnectionId),
  };
}

/** Newest first, with the event id breaking a tie so every pod agrees. */
function newestFirst(a: SsoConnectionHistoryEntry, b: SsoConnectionHistoryEntry): number {
  if (b.occurredAtMs !== a.occurredAtMs) return b.occurredAtMs - a.occurredAtMs;
  return b.eventId.localeCompare(a.eventId);
}
