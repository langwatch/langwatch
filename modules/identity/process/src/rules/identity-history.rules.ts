import {
  IDENTIFIER_ATTACHED_EVENT_TYPE,
  IDENTIFIER_DEAD_ENDED_EVENT_TYPE,
  IDENTIFIER_VERIFIED_EVENT_TYPE,
  type IdentityActor,
  type IdentityHistoryEntry,
  LINK_CONFIRMED_EVENT_TYPE,
  LINK_PROPOSED_EVENT_TYPE,
  LINK_REJECTED_EVENT_TYPE,
  type LinkProposalRecord,
  identityActorSchema,
} from "@langwatch/identity-contract";

import type { IdentityEvent } from "../eventing/identity-state.projection.ts";

/** Fields the identity payloads carry, read structurally rather than per type. */
interface IdentityPayloadShape {
  identifierId?: unknown;
  provider?: unknown;
  value?: unknown;
  domain?: unknown;
  connectionId?: unknown;
  proposalId?: unknown;
  actor?: unknown;
}

/** One person's log as the history panel reads it: newest first, at most `limit`. */
export function identityHistoryEntries({
  events,
  limit,
}: {
  events: readonly IdentityEvent[];
  limit: number;
}): IdentityHistoryEntry[] {
  return events.map(toHistoryEntry).toSorted(newestFirst).slice(0, limit);
}

/**
 * Every proposal in one person's log with what became of it, newest first.
 * A proposal is decided once: the first decision wins and a later one is a replay (ADR-117 §3).
 */
export function linkProposalsOf({
  userId,
  events,
}: {
  userId: string;
  events: readonly IdentityEvent[];
}): LinkProposalRecord[] {
  const proposals = new Map<string, LinkProposalRecord>();
  for (const event of events.toSorted(oldestFirst)) {
    if (event.type === LINK_PROPOSED_EVENT_TYPE) {
      proposals.set(event.data.proposalId, {
        proposalId: event.data.proposalId,
        userId,
        connectionId: event.data.connectionId,
        provider: event.data.provider,
        providerAccountId: event.data.providerAccountId,
        value: event.data.value,
        domain: event.data.domain,
        reason: event.data.reason,
        proposedAtMs: event.occurredAt,
        decision: null,
      });
      continue;
    }
    if (event.type !== LINK_CONFIRMED_EVENT_TYPE && event.type !== LINK_REJECTED_EVENT_TYPE) {
      continue;
    }
    const proposal = proposals.get(event.data.proposalId);
    if (!proposal || proposal.decision) continue;
    proposal.decision = {
      outcome: event.type === LINK_CONFIRMED_EVENT_TYPE ? "confirmed" : "rejected",
      byActorId: event.data.actor.id,
      atMs: event.occurredAt,
    };
  }
  return [...proposals.values()].toSorted((a, b) => b.proposedAtMs - a.proposedAtMs);
}

function extractText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function actorOf(value: unknown): IdentityActor {
  const parsed = identityActorSchema.safeParse(value);
  return parsed.success ? parsed.data : { type: "system", id: null };
}

/** The one enum each fact turns on, where it has one. */
function extractDetail(event: IdentityEvent): string | null {
  switch (event.type) {
    case IDENTIFIER_ATTACHED_EVENT_TYPE:
      return extractText(event.data.state);
    case IDENTIFIER_VERIFIED_EVENT_TYPE:
      return extractText(event.data.method);
    case IDENTIFIER_DEAD_ENDED_EVENT_TYPE:
      return extractText(event.data.reason);
    case LINK_PROPOSED_EVENT_TYPE:
      return extractText(event.data.reason);
    default:
      return null;
  }
}

function toHistoryEntry(event: IdentityEvent): IdentityHistoryEntry {
  const data: IdentityPayloadShape = event.data;
  return {
    eventId: event.id,
    type: event.type,
    occurredAtMs: event.occurredAt,
    actor: actorOf(data.actor),
    identifierId: extractText(data.identifierId),
    provider: extractText(data.provider),
    value: extractText(data.value),
    domain: extractText(data.domain),
    connectionId: extractText(data.connectionId),
    proposalId: extractText(data.proposalId),
    detail: extractDetail(event),
  };
}

/** Newest first, with the event id breaking a tie so every pod agrees. */
function newestFirst(a: IdentityHistoryEntry, b: IdentityHistoryEntry): number {
  if (b.occurredAtMs !== a.occurredAtMs) return b.occurredAtMs - a.occurredAtMs;
  return b.eventId.localeCompare(a.eventId);
}

function oldestFirst(a: IdentityEvent, b: IdentityEvent): number {
  if (a.occurredAt !== b.occurredAt) return a.occurredAt - b.occurredAt;
  return a.id.localeCompare(b.id);
}
