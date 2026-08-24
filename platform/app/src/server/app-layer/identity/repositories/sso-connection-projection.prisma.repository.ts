import type {
  SsoConnectionLifecycleState,
  SsoConnectionSource,
  SsoConnectionState,
  SsoConnectionType,
  SsoDomainVerification,
  SsoIdpMetadata,
  SsoVerificationMethod,
} from "@langwatch/identity";
import type {
  Prisma,
  PrismaClient,
  SsoConnection,
} from "~/generated/prisma/client";
import type { SsoConnectionFoldState } from "~/server/event-sourcing/pipelines/sso-connections/projections/ssoConnectionState.foldProjection";
import type { ProjectionStoreContext } from "~/server/event-sourcing/projections/projectionStoreContext";
import type {
  StateProjectionStore,
  StoredProjection,
} from "~/server/event-sourcing/projections/stateProjection.types";

/**
 * The connection pipeline's projection store (D04, ADR-117 §5): the Postgres
 * `SsoConnection` head and its cursor, written under the queue's
 * per-connection lock.
 *
 * One row per aggregate, so the cursor rides on the row itself rather than in
 * a sibling table — and the row is written last-field-wins in one upsert,
 * which makes the whole apply the commit marker. A crash before it leaves
 * nothing; a crash after it is a completed apply.
 *
 * Nothing outside the fold writes here. A hand-edited row is not a
 * configuration change, it is a value the next event or the next replay
 * overwrites — which is exactly why the backoffice goes through commands.
 */
export class PrismaSsoConnectionProjectionRepository
  implements StateProjectionStore<SsoConnectionFoldState>
{
  constructor(private readonly prisma: PrismaClient) {}

  async load(
    key: string,
    _context: ProjectionStoreContext,
  ): Promise<StoredProjection<SsoConnectionFoldState> | null> {
    const row = await this.prisma.ssoConnection.findUnique({
      where: { id: key },
    });
    if (!row) return null;
    return {
      state: {
        ...rowToConnection(row),
        CreatedAt: row.createdAt.getTime(),
        UpdatedAt: row.updatedAt.getTime(),
        LastEventOccurredAt: row.occurredAt.getTime(),
      },
      cursor: {
        acceptedAt: row.acceptedAt.getTime(),
        eventId: row.lastEventId,
      },
      occurredAt: row.occurredAt.getTime(),
      createdAt: row.createdAt.getTime(),
      updatedAt: row.updatedAt.getTime(),
      version: row.projectionVersion,
    };
  }

  async store(
    projection: StoredProjection<SsoConnectionFoldState>,
    context: ProjectionStoreContext,
  ): Promise<void> {
    const id = context.aggregateId;
    const { state } = projection;
    const columns = {
      organizationId: state.organizationId,
      type: state.type,
      state: state.state,
      claimedDomains: state.claimedDomains,
      approvedDomains: state.approvedDomains,
      verifiedDomains: state.verifiedDomains,
      // Prisma's `InputJsonValue` does not accept a typed array directly (it
      // wants an index signature), so the shape is asserted at the column
      // boundary. `rowToConnection` asserts it back on the way out, and both
      // sides name `SsoDomainVerification` — the reducer is what actually
      // decides the shape.
      domainVerifications:
        state.domainVerifications as unknown as Prisma.InputJsonValue,
      pendingVerification: state.pendingVerification ?? undefined,
      idpMetadata: state.idpMetadata,
      allowsJit: state.allowsJit,
      source: state.source,
      testLoginAccountId: state.testLoginAccountId,
      rejection: state.rejection ?? undefined,
      createdBy: state.createdBy,
      tearDownAfter:
        state.tearDownAfterMs === null ? null : new Date(state.tearDownAfterMs),
      occurredAt: new Date(projection.occurredAt),
      lastEventId: projection.cursor.eventId,
      acceptedAt: new Date(projection.cursor.acceptedAt),
      projectionVersion: projection.version,
      // Business time, from the events — not `now()`. A row whose timestamps
      // came from the clock would differ from the row a replay rebuilds, and
      // whole-row parity is what this projection promises.
      createdAt: new Date(state.createdAtMs),
      updatedAt: new Date(state.updatedAtMs),
    };
    await this.prisma.ssoConnection.upsert({
      where: { id },
      create: { id, ...columns },
      update: columns,
    });
  }
}

/**
 * One stored row back into the reducer's state. Exported because the routing
 * port and the guards' read repository need the same translation, and two
 * copies of it would eventually disagree about what a JSON column means.
 */
export function rowToConnection(row: SsoConnection): SsoConnectionState {
  return {
    connectionId: row.id,
    organizationId: row.organizationId,
    type: row.type as SsoConnectionType,
    state: row.state as SsoConnectionLifecycleState,
    claimedDomains: row.claimedDomains,
    approvedDomains: row.approvedDomains,
    verifiedDomains: row.verifiedDomains,
    domainVerifications: Array.isArray(row.domainVerifications)
      ? (row.domainVerifications as unknown as SsoDomainVerification[])
      : [],
    pendingVerification: row.pendingVerification
      ? (row.pendingVerification as unknown as {
          domain: string;
          method: SsoVerificationMethod;
          tokenHash: string;
        })
      : null,
    idpMetadata: row.idpMetadata as unknown as SsoIdpMetadata,
    allowsJit: row.allowsJit,
    source: row.source as SsoConnectionSource,
    testLoginAccountId: row.testLoginAccountId,
    rejection: row.rejection
      ? (row.rejection as unknown as { domain: string; note: string })
      : null,
    createdBy: row.createdBy,
    createdAtMs: row.createdAt.getTime(),
    updatedAtMs: row.updatedAt.getTime(),
    tearDownAfterMs: row.tearDownAfter?.getTime() ?? null,
  };
}
