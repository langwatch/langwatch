import type {
  SsoArrivalPolicy,
  SsoConnectionLifecycleState,
  SsoConnectionSource,
  SsoConnectionState,
  SsoConnectionType,
  SsoDomainClaim,
  SsoDomainVerification,
  SsoIdpMetadata,
  SsoVerificationMethod,
} from "@langwatch/identity";
import { lapsedDomains, type SsoDomainProofState } from "@langwatch/identity";
import type { SsoEngineProviderRow } from "@langwatch/identity-server";
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
  constructor(
    private readonly prisma: PrismaClient,
    /**
     * How the engine's provider row is derived from the same state (D09).
     *
     * Injected rather than built here so this class keeps holding no policy,
     * and so a test can fold a connection without a credential vault. Absent,
     * the engine's table is simply not maintained — which is what every test
     * written before D09 expects, and what a deployment mounting no single
     * sign-on plugin would want.
     */
    private readonly engineProvider?: SsoEngineProviderDerivation,
  ) {}

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
      // The claim rows the tier-3 queue reads and sorts. Asserted at the
      // column boundary for the same reason `domainVerifications` is.
      domainClaims: state.domainClaims as unknown as Prisma.InputJsonValue,
      approvedDomains: state.approvedDomains,
      verifiedDomains: state.verifiedDomains,
      // The subset of `verifiedDomains` whose published record stayed missing
      // through its grace (ADR-123). A column of its own rather than a read
      // over the JSON above, because the two questions that consult it —
      // "may this person be provisioned" and "may this person join by
      // domain" — are asked on a sign-in path and have to be one indexed
      // predicate, not a fold.
      lapsedDomains: lapsedDomains(state),
      // Prisma's `InputJsonValue` does not accept a typed array directly (it
      // wants an index signature), so the shape is asserted at the column
      // boundary. `rowToConnection` asserts it back on the way out, and both
      // sides name `SsoDomainVerification` — the reducer is what actually
      // decides the shape.
      domainVerifications:
        state.domainVerifications as unknown as Prisma.InputJsonValue,
      pendingVerification: state.pendingVerification ?? undefined,
      idpMetadata: state.idpMetadata,
      arrivalPolicy: state.arrivalPolicy,
      arrivalPolicyDecidedAt:
        state.arrivalPolicyDecidedAtMs === null
          ? null
          : new Date(state.arrivalPolicyDecidedAtMs),
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
    await this.projectEngineProvider({ connectionId: id, state });
  }

  /**
   * The engine's provider row, folded from the same state in the same apply
   * (D09 — see specs/identity/sso-idp-termination.feature).
   *
   * better-auth's single sign-on plugin owns those columns and every read of
   * them, but it does not own whether a row exists: that is derived here, so
   * the plugin's table is a projection of the connection log rather than a
   * second source of truth somebody has to keep in step. Replay the ledger
   * and both rows come back.
   *
   * Written after the head and not in a transaction with it, on purpose. The
   * head is the commit marker this projection has always used, and the engine
   * row is derived entirely FROM the head — so a crash between the two leaves
   * a provider row that the next apply or the next replay rewrites, never a
   * provider row that outlives the connection justifying it.
   */
  private async projectEngineProvider({
    connectionId,
    state,
  }: {
    connectionId: string;
    state: SsoConnectionState;
  }): Promise<void> {
    if (this.engineProvider === undefined) return;
    const row = await this.engineProvider({ connection: state });
    if (row === null) {
      // Deleted rather than disabled. A suspended or torn-down connection
      // must stop being dialable, and a row the engine can still find is a
      // row it will still authenticate through.
      await this.prisma.ssoProvider.deleteMany({ where: { id: connectionId } });
      return;
    }
    const columns = {
      issuer: row.issuer,
      oidcConfig: row.oidcConfig,
      samlConfig: row.samlConfig,
      providerId: row.providerId,
      organizationId: row.organizationId,
      domain: row.domain,
    };
    await this.prisma.ssoProvider.upsert({
      where: { id: row.id },
      create: { id: row.id, ...columns },
      update: columns,
    });
  }
}

/** The derivation the fold applies, as this store needs it: one connection's
 *  state in, the engine's row or nothing out. */
export type SsoEngineProviderDerivation = (args: {
  connection: SsoConnectionState;
}) => Promise<SsoEngineProviderRow | null>;

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
    domainClaims: Array.isArray(row.domainClaims)
      ? (row.domainClaims as unknown as SsoDomainClaim[])
      : [],
    approvedDomains: row.approvedDomains,
    verifiedDomains: row.verifiedDomains,
    domainVerifications: Array.isArray(row.domainVerifications)
      ? row.domainVerifications.map(toDomainVerification)
      : [],
    pendingVerification: row.pendingVerification
      ? (row.pendingVerification as unknown as {
          domain: string;
          method: SsoVerificationMethod;
          tokenHash: string;
          expiresAtMs: number | null;
        })
      : null,
    idpMetadata: row.idpMetadata as unknown as SsoIdpMetadata,
    arrivalPolicy: row.arrivalPolicy as SsoArrivalPolicy,
    arrivalPolicyDecidedAtMs: row.arrivalPolicyDecidedAt?.getTime() ?? null,
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

/**
 * One stored verification back into the reducer's shape, with the condition
 * fields defaulted (ADR-123).
 *
 * Every proof recorded before re-verification existed was written without
 * them, and the honest reading of such a row is exactly what it meant then: a
 * domain nothing had contradicted, proved by a record whose hash we did not
 * keep. Defaulting HERE rather than trusting the cast is what stops those
 * rows decoding with an `undefined` proof state that every downstream
 * comparison would then quietly get wrong — and the absent hash is what keeps
 * the sweep from re-reading a domain it could not judge.
 */
function toDomainVerification(raw: unknown): SsoDomainVerification {
  const entry = raw as Partial<SsoDomainVerification> & {
    domain: string;
    method: SsoVerificationMethod;
  };
  return {
    domain: entry.domain,
    method: entry.method,
    actorId: entry.actorId ?? null,
    verifiedAtMs: entry.verifiedAtMs ?? 0,
    proofState: (entry.proofState ?? "VERIFIED") as SsoDomainProofState,
    firstAbsentAtMs: entry.firstAbsentAtMs ?? null,
    graceEndsAtMs: entry.graceEndsAtMs ?? null,
    tokenHash: entry.tokenHash ?? null,
  };
}
