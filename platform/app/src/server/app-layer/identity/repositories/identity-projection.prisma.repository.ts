import type { PrismaClient } from "~/generated/prisma/client";
import type { IdentityFoldState } from "~/server/event-sourcing/pipelines/identity/projections/identityState.foldProjection";
import {
  IDENTIFIER_LIFECYCLE_STATES,
  type IdentifierFact,
  type IdentifierLifecycleState,
} from "~/server/event-sourcing/pipelines/identity/projections/reduceIdentity";
import { identifierProviderSchema } from "~/server/event-sourcing/pipelines/identity/schemas/events";
import type { ProjectionStoreContext } from "~/server/event-sourcing/projections/projectionStoreContext";
import type {
  StateProjectionStore,
  StoredProjection,
} from "~/server/event-sourcing/projections/stateProjection.types";

function parseLifecycleState(raw: string): IdentifierLifecycleState {
  const state = IDENTIFIER_LIFECYCLE_STATES.find(
    (candidate) => candidate === raw,
  );
  if (!state) {
    throw new Error(`Identifier row carries unknown state "${raw}"`);
  }
  return state;
}

interface IdentifierRowShape {
  id: string;
  userId: string;
  provider: string;
  value: string | null;
  domain: string | null;
  identifierHash: string | null;
  accountId: string | null;
  state: string;
  connectionId: string | null;
  verifiedAt: Date | null;
  attachedAt: Date;
  detachedAt: Date | null;
}

function rowToFact(row: IdentifierRowShape): IdentifierFact {
  return {
    identifierId: row.id,
    userId: row.userId,
    provider: identifierProviderSchema.parse(row.provider),
    value: row.value,
    domain: row.domain,
    identifierHash: row.identifierHash,
    accountId: row.accountId,
    connectionId: row.connectionId,
    state: parseLifecycleState(row.state),
    verifiedAtMs: row.verifiedAt?.getTime() ?? null,
    attachedAtMs: row.attachedAt.getTime(),
    detachedAtMs: row.detachedAt?.getTime() ?? null,
  };
}

function factToRow(fact: IdentifierFact): IdentifierRowShape {
  return {
    id: fact.identifierId,
    userId: fact.userId,
    provider: fact.provider,
    value: fact.value,
    domain: fact.domain,
    identifierHash: fact.identifierHash,
    accountId: fact.accountId,
    state: fact.state,
    connectionId: fact.connectionId,
    verifiedAt: fact.verifiedAtMs === null ? null : new Date(fact.verifiedAtMs),
    attachedAt: new Date(fact.attachedAtMs),
    detachedAt: fact.detachedAtMs === null ? null : new Date(fact.detachedAtMs),
  };
}

/**
 * The identity pipeline's projection store (ADR-101 §3): the Postgres
 * `Identifier` head plus its cursor, written under the queue's per-user
 * lock. A pure event-truth head — every column is fold-written, rows are
 * never deleted (DETACHED is a tombstone; erasure wipes value columns and
 * keeps the row), so `store()` is upserts and a cursor, nothing departs.
 */
export class PrismaIdentityProjectionRepository
  implements StateProjectionStore<IdentityFoldState>
{
  constructor(private readonly prisma: PrismaClient) {}

  async load(
    key: string,
    _context: ProjectionStoreContext,
  ): Promise<StoredProjection<IdentityFoldState> | null> {
    const userId = key;
    const cursor = await this.prisma.identityProjectionCursor.findUnique({
      where: { userId },
    });
    if (!cursor) return null;

    const rows = await this.prisma.identifier.findMany({ where: { userId } });
    const state: IdentityFoldState = {
      CreatedAt: cursor.createdAt.getTime(),
      UpdatedAt: cursor.updatedAt.getTime(),
      LastEventOccurredAt: cursor.occurredAt.getTime(),
      userId,
      identifiers: Object.fromEntries(
        rows.map((row) => {
          const fact = rowToFact(row);
          return [fact.identifierId, fact];
        }),
      ),
    };
    return {
      state,
      cursor: {
        acceptedAt: cursor.acceptedAt.getTime(),
        eventId: cursor.lastEventId,
      },
      occurredAt: cursor.occurredAt.getTime(),
      createdAt: cursor.createdAt.getTime(),
      updatedAt: cursor.updatedAt.getTime(),
      version: cursor.projectionVersion,
    };
  }

  async store(
    projection: StoredProjection<IdentityFoldState>,
    context: ProjectionStoreContext,
  ): Promise<void> {
    const userId = context.aggregateId;
    const { state } = projection;

    for (const fact of Object.values(state.identifiers)) {
      const row = factToRow(fact);
      const { id, ...columns } = row;
      await this.prisma.identifier.upsert({
        where: { id },
        create: { id, ...columns },
        update: columns,
      });
    }

    // Cursor last: it is the commit marker. A crash before this line leaves
    // rows a re-applied event overwrites idempotently; a crash after it is
    // a completed apply.
    await this.prisma.identityProjectionCursor.upsert({
      where: { userId },
      create: {
        userId,
        lastEventId: projection.cursor.eventId,
        acceptedAt: new Date(projection.cursor.acceptedAt),
        occurredAt: new Date(projection.occurredAt),
        projectionVersion: projection.version,
      },
      update: {
        lastEventId: projection.cursor.eventId,
        acceptedAt: new Date(projection.cursor.acceptedAt),
        occurredAt: new Date(projection.occurredAt),
        projectionVersion: projection.version,
      },
    });
  }
}
