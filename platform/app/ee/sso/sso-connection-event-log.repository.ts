// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * A connection's history, read as a sequence (ADR-117 SS5, D04).
 *
 * The `SsoConnection` projection answers "where does this connection stand
 * right now"; an administrator who just claimed a domain or an operator
 * chasing a dispute is asking "what actually happened, in order" - and that
 * question is the log itself, not the head. Exactly the identity pipeline's
 * own history panel (`identity-event-log.repository.ts`) and the directory
 * sync log (`scim-sync-event-log.repository.ts`) both read their pipeline's
 * events the same way, for the same reason.
 *
 * A read, and only a read. No new fact, no projection, nothing appended: the
 * pipeline already writes every one of these events
 * (`SsoConnectionLedgerWriter`), and this renders them. That is also what
 * makes the panel rebuildable for free - it shows nothing the log cannot
 * re-derive, because it IS the log.
 *
 * Tenancy is structural, like the identity log's and the SCIM sync log's:
 * this aggregate's id is the connection and its tenant is the organization
 * (ADR-117 SS5), so a read is one tenant scan by construction - passing
 * another organization's connection id under this organization's tenant
 * finds nothing, which is exactly how a connection that does not exist
 * reads.
 *
 * The field list is the payload rule (ADR-101 SS4) written down again: every
 * `SsoConnectionEvent` payload carries opaque ids, enums, a domain and
 * `source` (never a client secret or a verification token - those stay
 * references and hashes on the wire), so a reader that projects them
 * inherits no secret a future fact might carry.
 */

import { SSO_CONNECTION_AGGREGATE_TYPE } from "@ee/event-sourcing/pipelines/sso-connections/schemas/constants";
import type { SsoConnectionEvent } from "@ee/event-sourcing/pipelines/sso-connections/schemas/events";
import type {
  SsoConnectionEventType,
  SsoConnectionSource,
} from "@langwatch/identity";
import { resolveEventStore } from "~/server/app-layer/identity/ledger";
import { createTenantId } from "~/server/event-sourcing";
import type { AggregateType } from "~/server/event-sourcing/domain/aggregateType";
import type { EventStore } from "~/server/event-sourcing/stores/eventStore.types";

/**
 * One fact about a connection, as an administrator or an operator reads it.
 *
 * Structural fields only - the copy layer (`sso-connection-history-copy.ts`)
 * is where a `type` plus these turn into a sentence. Every field here is
 * something at least one event carries; a fact that does not name a domain,
 * a method and so on simply leaves that field null.
 */
export interface SsoConnectionHistoryEntry {
  eventId: string;
  type: SsoConnectionEventType;
  occurredAtMs: number;
  /** Whether a human configured this fact or the grandfather migration
   *  produced it from an existing legacy configuration. */
  source: SsoConnectionSource;
  domain: string | null;
  /** How a domain was, or is being, proved: `dns-txt`, `https-file`,
   *  `license-token`, `operator-attested` or `legacy-configuration`. */
  method: string | null;
  /** The migration route a `migration_route_selected` fact names. */
  route: string | null;
  /** The arrival policy a `connection_arrival_policy_set` fact names. */
  policy: string | null;
  /** The name a `connection_renamed` fact gives the connection. */
  name: string | null;
  /** Free text an actor gave: a claim's rejection note, an attestation's
   *  note, or a suspend/teardown reason. Never a secret - these are the
   *  same words the connection's own projection already carries back to
   *  whoever reads it. */
  note: string | null;
  /** The connection this one replaces, on a `replacement_connection_
   *  registered` fact. */
  replacesConnectionId: string | null;
}

/** The history read this surface, and the back office's, both take. */
export interface SsoConnectionHistoryReadsRepository {
  findHistory(input: {
    organizationId: string;
    connectionId: string;
    limit: number;
  }): Promise<readonly SsoConnectionHistoryEntry[]>;
}

/** Fields the connection payloads carry, read structurally rather than
 *  parsed per type - the reader wants the same handful of columns off every
 *  fact, exactly as the identity and SCIM sync logs do. */
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

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export class EventLogSsoConnectionHistoryRepository
  implements SsoConnectionHistoryReadsRepository
{
  private readonly eventStore: () => Promise<EventStore<SsoConnectionEvent>>;

  constructor(deps?: {
    /** Production resolves the App's event store lazily; tests hand one in. */
    eventStore?: () => Promise<EventStore<SsoConnectionEvent>>;
  }) {
    this.eventStore =
      deps?.eventStore ?? (() => resolveEventStore<SsoConnectionEvent>());
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
      SSO_CONNECTION_AGGREGATE_TYPE as AggregateType,
    );
    return events
      .map((event) => toHistoryEntry(event))
      .sort(newestFirst)
      .slice(0, limit);
  }
}

function toHistoryEntry(event: SsoConnectionEvent): SsoConnectionHistoryEntry {
  const data = event.data as SsoConnectionPayloadShape;
  return {
    eventId: event.id,
    type: event.type as SsoConnectionEventType,
    occurredAtMs: event.occurredAt,
    // Every payload carries `source` (see `sourced` in connection.ts); the
    // fallback is only for a malformed test fixture, never for production
    // data.
    source: (text(data.source) ?? "self-serve") as SsoConnectionSource,
    domain: text(data.domain),
    method: text(data.method),
    route: text(data.route),
    policy: text(data.policy),
    name: text(data.name),
    note: text(data.note) ?? text(data.reason),
    replacesConnectionId: text(data.replacesConnectionId),
  };
}

/** Newest first, with the event id breaking a tie so every pod agrees. */
function newestFirst(
  a: SsoConnectionHistoryEntry,
  b: SsoConnectionHistoryEntry,
): number {
  if (b.occurredAtMs !== a.occurredAtMs) return b.occurredAtMs - a.occurredAtMs;
  return b.eventId.localeCompare(a.eventId);
}
