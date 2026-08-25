import type { IdentityActor, IdentityEventType } from "@langwatch/identity";
import {
  IDENTIFIER_ATTACHED_EVENT_TYPE,
  IDENTIFIER_DEAD_ENDED_EVENT_TYPE,
  IDENTIFIER_DETACHED_EVENT_TYPE,
  IDENTIFIER_VERIFIED_EVENT_TYPE,
  LINK_CONFIRMED_EVENT_TYPE,
  LINK_PROPOSED_EVENT_TYPE,
  LINK_REJECTED_EVENT_TYPE,
  PRIMARY_CHANGED_EVENT_TYPE,
  USER_ERASED_EVENT_TYPE,
} from "@langwatch/identity";
import type {
  LinkProposalReadsRepository,
  LinkProposalRecord,
} from "@langwatch/identity-server";
import { createTenantId } from "~/server/event-sourcing";
import type { AggregateType } from "~/server/event-sourcing/domain/aggregateType";
import { USER_IDENTITY_AGGREGATE_TYPE } from "~/server/event-sourcing/pipelines/identity/schemas/constants";
import type { IdentityEvent } from "~/server/event-sourcing/pipelines/identity/schemas/events";
import type { EventStore } from "~/server/event-sourcing/stores/eventStore.types";
import { resolveIdentityEventStore } from "../ledger";

/**
 * One thing that happened to somebody's identity, as an operator reads it.
 *
 * The field list IS the payload rule (ADR-101 §4) written down: opaque ids,
 * enums, timestamps, domains, and the normalized address where the fact is
 * about one. There is no field here a secret could travel in — not because
 * we filter secrets out, but because identity facts never carry one, and a
 * reader that projected the raw payload would inherit whatever a future fact
 * put there.
 */
export interface IdentityHistoryEntry {
  eventId: string;
  type: IdentityEventType;
  occurredAtMs: number;
  /** Who caused it: a person, or the system. */
  actor: IdentityActor;
  identifierId: string | null;
  provider: string | null;
  /** The address, where the fact is about one; null once erasure wipes it. */
  value: string | null;
  domain: string | null;
  connectionId: string | null;
  proposalId: string | null;
  /**
   * The one enum the fact turns on — how an identifier was proved, why it
   * dead-ended, why a link was proposed. One field rather than three,
   * because the surface renders it as one line of prose either way.
   */
  detail: string | null;
}

/** The history reads the operator lookup takes. */
export interface IdentityHistoryReadsRepository {
  findHistory(input: {
    userId: string;
    limit: number;
  }): Promise<readonly IdentityHistoryEntry[]>;
}

/** Fields the identity payloads carry, read structurally rather than parsed
 *  per type: the reader wants the same six columns off every fact. */
interface IdentityPayloadShape {
  identifierId?: unknown;
  provider?: unknown;
  value?: unknown;
  domain?: unknown;
  connectionId?: unknown;
  proposalId?: unknown;
  providerAccountId?: unknown;
  method?: unknown;
  reason?: unknown;
  state?: unknown;
  actor?: unknown;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function actorOf(value: unknown): IdentityActor {
  const actor = value as IdentityActor | undefined;
  if (actor && (actor.type === "user" || actor.type === "system")) {
    return { type: actor.type, id: text(actor.id) };
  }
  return { type: "system", id: null };
}

/**
 * The identity log, read.
 *
 * Both readers this deliverable needs come off the same scan: the history
 * panel wants the last N facts newest-first, and a proposal's state is the
 * fold of `link_proposed` against `link_confirmed` / `link_rejected`. There
 * is no proposal row to read instead — a proposal changes no head — so the
 * log is not a shortcut here, it is the only source there is.
 *
 * Tenancy is the user: `tenantId === userId` on this aggregate (ADR-101 §3),
 * so a read is a single-tenant scan by construction and cannot be widened by
 * passing the wrong id — the wrong id reads a different person's history,
 * which is exactly one person's history, which is what the caller asked for.
 */
export class EventLogIdentityRepository
  implements LinkProposalReadsRepository, IdentityHistoryReadsRepository
{
  private readonly eventStore: () => Promise<EventStore<IdentityEvent>>;

  constructor(deps?: {
    /** Production resolves the App's event store lazily; tests hand one in. */
    eventStore?: () => Promise<EventStore<IdentityEvent>>;
  }) {
    this.eventStore = deps?.eventStore ?? resolveIdentityEventStore;
  }

  async findHistory({
    userId,
    limit,
  }: {
    userId: string;
    limit: number;
  }): Promise<readonly IdentityHistoryEntry[]> {
    const events = await this.readEvents({ userId });
    return events
      .map((event) => toHistoryEntry(event))
      .sort(newestFirst)
      .slice(0, limit);
  }

  async findProposal({
    userId,
    proposalId,
  }: {
    userId: string;
    proposalId: string;
  }): Promise<LinkProposalRecord | null> {
    const proposals = await this.findProposals({ userId });
    return proposals.find((p) => p.proposalId === proposalId) ?? null;
  }

  async findProposals({
    userId,
  }: {
    userId: string;
  }): Promise<readonly LinkProposalRecord[]> {
    const events = await this.readEvents({ userId });
    const proposals = new Map<string, LinkProposalRecord>();

    for (const event of [...events].sort(oldestFirstEvents)) {
      const data = event.data as IdentityPayloadShape;
      const proposalId = text(data.proposalId);
      if (!proposalId) continue;

      if (event.type === LINK_PROPOSED_EVENT_TYPE) {
        proposals.set(proposalId, {
          proposalId,
          userId,
          connectionId: text(data.connectionId),
          provider: (text(data.provider) ??
            "email") as LinkProposalRecord["provider"],
          providerAccountId: text(data.providerAccountId) ?? "",
          value: text(data.value),
          domain: text(data.domain),
          reason: (text(data.reason) ??
            "ambiguous_candidates") as LinkProposalRecord["reason"],
          proposedAtMs: event.occurredAt,
          decision: null,
        });
        continue;
      }

      const existing = proposals.get(proposalId);
      if (!existing || existing.decision) continue;
      if (event.type === LINK_CONFIRMED_EVENT_TYPE) {
        existing.decision = {
          outcome: "confirmed",
          byActorId: actorOf(data.actor).id,
          atMs: event.occurredAt,
        };
      } else if (event.type === LINK_REJECTED_EVENT_TYPE) {
        existing.decision = {
          outcome: "rejected",
          byActorId: actorOf(data.actor).id,
          atMs: event.occurredAt,
        };
      }
    }

    return [...proposals.values()].sort(
      (a, b) => b.proposedAtMs - a.proposedAtMs,
    );
  }

  private async readEvents({
    userId,
  }: {
    userId: string;
  }): Promise<readonly IdentityEvent[]> {
    const store = await this.eventStore();
    return store.getEvents(
      userId,
      { tenantId: createTenantId(userId) },
      USER_IDENTITY_AGGREGATE_TYPE as AggregateType,
    );
  }
}

/** The enum each fact turns on, whichever one it has. */
function detailOf({
  type,
  data,
}: {
  type: string;
  data: IdentityPayloadShape;
}): string | null {
  switch (type) {
    case IDENTIFIER_ATTACHED_EVENT_TYPE:
      return text(data.state);
    case IDENTIFIER_VERIFIED_EVENT_TYPE:
      return text(data.method);
    case IDENTIFIER_DEAD_ENDED_EVENT_TYPE:
      return text(data.reason);
    case LINK_PROPOSED_EVENT_TYPE:
      return text(data.reason);
    case IDENTIFIER_DETACHED_EVENT_TYPE:
    case PRIMARY_CHANGED_EVENT_TYPE:
    case USER_ERASED_EVENT_TYPE:
    case LINK_CONFIRMED_EVENT_TYPE:
    case LINK_REJECTED_EVENT_TYPE:
      return null;
    default:
      return null;
  }
}

function toHistoryEntry(event: IdentityEvent): IdentityHistoryEntry {
  const data = event.data as IdentityPayloadShape;
  return {
    eventId: event.id,
    type: event.type,
    occurredAtMs: event.occurredAt,
    actor: actorOf(data.actor),
    identifierId: text(data.identifierId),
    provider: text(data.provider),
    value: text(data.value),
    domain: text(data.domain),
    connectionId: text(data.connectionId),
    proposalId: text(data.proposalId),
    detail: detailOf({ type: event.type, data }),
  };
}

/** Newest first, with the event id breaking a tie so every pod agrees. */
function newestFirst(a: IdentityHistoryEntry, b: IdentityHistoryEntry): number {
  if (b.occurredAtMs !== a.occurredAtMs) return b.occurredAtMs - a.occurredAtMs;
  return b.eventId.localeCompare(a.eventId);
}

function oldestFirstEvents(a: IdentityEvent, b: IdentityEvent): number {
  if (a.occurredAt !== b.occurredAt) return a.occurredAt - b.occurredAt;
  return a.id.localeCompare(b.id);
}
