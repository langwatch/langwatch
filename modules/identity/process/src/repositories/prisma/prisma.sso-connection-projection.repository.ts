import type {
  ProjectionStoreContext,
  StateProjectionStore,
  StoredProjection,
  StoredProjectionRead,
} from "@langwatch/eventing";
import {
  DEFAULT_SSO_ARRIVAL_POLICY,
  domainClaimRejectedPayloadSchema,
  isSsoArrivalPolicy,
  ssoDomainClaimSchema,
  ssoDomainVerificationSchema,
  ssoIdpMetadataSchema,
  verificationRequestedPayloadSchema,
} from "@langwatch/identity-contract";
import type {
  SsoConnectionLifecycleState,
  SsoConnectionSource,
  SsoConnectionState,
  SsoConnectionType,
} from "@langwatch/identity-contract";
import type { Prisma, PrismaClient, SsoConnection } from "@langwatch/prisma-client/generated";
import { z } from "zod";

import type { SsoConnectionFoldState } from "../../eventing/sso-connection-state.projection.ts";
import {
  isTerminalSsoConnection,
  ownedVerifiedDomains,
  verifiedDomainCanBeShared,
} from "../../rules/sso-domain-ownership.rules.ts";
import { PrismaSsoBreakGlassRepository } from "./prisma.sso-break-glass.repository.ts";

/** The connection head, and the ownership rows written in the same transaction. */
export type PrismaSsoConnectionProjectionDatabase = Pick<
  PrismaClient,
  "ssoConnection" | "$transaction"
>;

const storedDomainClaimsSchema = z.array(ssoDomainClaimSchema).catch([]);

/** The proof condition a decoded row carries. A row written before ADR-123
 *  has none and reads as VERIFIED: nothing had doubted it, and fabricating a
 *  clock would start one nobody set. */
function provedCondition(entry: unknown): unknown {
  if (typeof entry !== "object" || entry === null) return entry;
  const stored = Object.fromEntries(Object.entries(entry));
  return {
    ...stored,
    proofState: stored["proofState"] ?? "VERIFIED",
    firstAbsentAtMs: stored["firstAbsentAtMs"] ?? null,
    graceEndsAtMs: stored["graceEndsAtMs"] ?? null,
    tokenHash: stored["tokenHash"] ?? null,
  };
}

const storedDomainVerificationsSchema = z.array(
  z.preprocess(provedCondition, ssoDomainVerificationSchema),
);
/** A ceremony written before ceremonies could expire reads with no deadline. */
const storedPendingVerificationSchema = verificationRequestedPayloadSchema.pick({
  domain: true,
  method: true,
  tokenHash: true,
  expiresAtMs: true,
});
const storedRejectionSchema = domainClaimRejectedPayloadSchema.pick({ domain: true, note: true });

/**
 * `SsoConnection` head and its cursor, written under the queue's per-connection lock.
 * The connection pipeline's projection store (D04, ADR-117 §5): the Postgres
 */
export class PrismaSsoConnectionProjectionRepository implements StateProjectionStore<SsoConnectionFoldState> {
  static create(
    database: PrismaSsoConnectionProjectionDatabase,
  ): PrismaSsoConnectionProjectionRepository {
    return new PrismaSsoConnectionProjectionRepository(database);
  }

  constructor(private readonly prisma: PrismaSsoConnectionProjectionDatabase) {}

  async get(
    key: string,
    _context: ProjectionStoreContext,
  ): Promise<StoredProjectionRead<SsoConnectionFoldState>> {
    const row = await this.prisma.ssoConnection.findUnique({
      where: { id: key },
    });
    if (!row) return { kind: "empty" };
    return {
      kind: "folded",
      projection: {
        state: {
          ...PrismaSsoConnectionProjectionRepository.rowToConnection(row),
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
      },
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
      domainClaims: state.domainClaims,
      approvedDomains: state.approvedDomains,
      verifiedDomains: state.verifiedDomains,
      domainVerifications: state.domainVerifications,
      pendingVerification: state.pendingVerification ?? undefined,
      idpMetadata: state.idpMetadata,
      arrivalPolicy: state.arrivalPolicy,
      arrivalPolicyDecidedAt:
        state.arrivalPolicyDecidedAtMs === null ? null : new Date(state.arrivalPolicyDecidedAtMs),
      // The dead column, kept in step for one release: the previous release's
      // pods still select it by name on every connection read.
      allowsJit: state.arrivalPolicy === "admit",
      source: state.source,
      testLoginAccountId: state.testLoginAccountId,
      replacesConnectionId: state.replacesConnectionId,
      migrationPhase: state.migrationPhase,
      graceStartedAt: state.graceStartedAtMs === null ? null : new Date(state.graceStartedAtMs),
      routeChangedAt: state.routeChangedAtMs === null ? null : new Date(state.routeChangedAtMs),
      finalizationRequestedAt:
        state.finalizationRequestedAtMs === null ? null : new Date(state.finalizationRequestedAtMs),
      finalizedAt: state.finalizedAtMs === null ? null : new Date(state.finalizedAtMs),
      rejection: state.rejection ?? undefined,
      createdBy: state.createdBy,
      tearDownAfter: state.tearDownAfterMs === null ? null : new Date(state.tearDownAfterMs),
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
    // The head and the ownership rows together, or neither: the owner row is
    // what the database refuses a second organization on.
    await this.prisma.$transaction(async (tx) => {
      const reservations = state.ActivationReservationCommandIds ?? [];
      const terminal = isTerminalSsoConnection(state.state);
      if (reservations.length > 0 || terminal) {
        await PrismaSsoBreakGlassRepository.lockOrganizationInTransaction(tx, state.organizationId);
      }
      await tx.ssoConnection.upsert({
        where: { id },
        create: { id, ...columns },
        update: columns,
      });
      await projectDomainOwnership({ tx, connectionId: id, state });
      for (const commandId of reservations) {
        await PrismaSsoBreakGlassRepository.consumeReservationInTransaction(tx, {
          organizationId: state.organizationId,
          connectionId: id,
          commandId,
        });
      }
      if (terminal) {
        await PrismaSsoBreakGlassRepository.cancelReservationInTransaction(tx, {
          organizationId: state.organizationId,
          connectionId: id,
        });
      }
    });
  }

  /** The ownership rows a head holds, inside the caller's transaction (the backfill's write). */
  static async projectOwnershipInTransaction(
    tx: Prisma.TransactionClient,
    { connectionId, state }: { connectionId: string; state: SsoConnectionState },
  ): Promise<void> {
    await projectDomainOwnership({ tx, connectionId, state });
  }

  /**
   * One stored row back into the reducer's state. Exported because the routing
   * port and the guards' read repository need the same translation, and two
   * copies of it would eventually disagree about what a JSON column means.
   */
  static rowToConnection(row: SsoConnection): SsoConnectionState {
    return {
      connectionId: row.id,
      organizationId: row.organizationId,
      type: row.type as SsoConnectionType,
      state: row.state as SsoConnectionLifecycleState,
      claimedDomains: row.claimedDomains,
      domainClaims: storedDomainClaimsSchema.parse(row.domainClaims),
      approvedDomains: row.approvedDomains,
      verifiedDomains: row.verifiedDomains,
      domainVerifications: Array.isArray(row.domainVerifications)
        ? storedDomainVerificationsSchema.parse(row.domainVerifications)
        : [],
      pendingVerification: row.pendingVerification
        ? storedPendingVerificationSchema.parse(row.pendingVerification)
        : null,
      idpMetadata: ssoIdpMetadataSchema.parse(row.idpMetadata),
      arrivalPolicy: isSsoArrivalPolicy(row.arrivalPolicy)
        ? row.arrivalPolicy
        : DEFAULT_SSO_ARRIVAL_POLICY,
      arrivalPolicyDecidedAtMs: row.arrivalPolicyDecidedAt?.getTime() ?? null,
      source: row.source as SsoConnectionSource,
      testLoginAccountId: row.testLoginAccountId,
      rejection: row.rejection ? storedRejectionSchema.parse(row.rejection) : null,
      createdBy: row.createdBy,
      createdAtMs: row.createdAt.getTime(),
      updatedAtMs: row.updatedAt.getTime(),
      tearDownAfterMs: row.tearDownAfter?.getTime() ?? null,
      replacesConnectionId: row.replacesConnectionId,
      migrationPhase: row.migrationPhase,
      graceStartedAtMs: row.graceStartedAt?.getTime() ?? null,
      routeChangedAtMs: row.routeChangedAt?.getTime() ?? null,
      finalizationRequestedAtMs: row.finalizationRequestedAt?.getTime() ?? null,
      finalizedAtMs: row.finalizedAt?.getTime() ?? null,
    };
  }
}

/**
 * The ownership rows this connection's proved domains hold; rows it no longer
 * holds are dropped, so a withdrawn domain can be proved by the next
 * organization. The constraints close the cross-organization race.
 */
async function projectDomainOwnership({
  tx,
  connectionId,
  state,
}: {
  tx: Prisma.TransactionClient;
  connectionId: string;
  state: SsoConnectionState;
}): Promise<void> {
  const held = ownedVerifiedDomains(state);
  const projected = await tx.ssoVerifiedDomainHolder.findMany({
    where: { connectionId },
    select: { domain: true },
  });
  const released = projected
    .map((holder) => holder.domain)
    .filter((domain) => !held.includes(domain));
  if (released.length > 0) {
    await tx.ssoVerifiedDomainHolder.deleteMany({
      where: { connectionId, domain: { in: released } },
    });
    await tx.ssoVerifiedDomain.deleteMany({
      where: { domain: { in: released }, holders: { none: {} } },
    });
  }
  for (const domain of held) {
    await projectDomainHolder({ tx, domain, connectionId, organizationId: state.organizationId });
  }
}

async function projectDomainHolder({
  tx,
  domain,
  connectionId,
  organizationId,
}: {
  tx: Prisma.TransactionClient;
  domain: string;
  connectionId: string;
  organizationId: string;
}): Promise<void> {
  await tx.ssoVerifiedDomain.createMany({
    data: [{ domain, organizationId }],
    skipDuplicates: true,
  });
  const ownership = await tx.ssoVerifiedDomain.findUnique({
    where: { domain },
    select: { organizationId: true, holders: { select: { connectionId: true } } },
  });
  // Plain errors on purpose: the guards refuse these first, so reaching one
  // is a race the database closed, not something a caller can act on.
  if (ownership === null || ownership.organizationId !== organizationId) {
    throw new Error(
      `sso_domain_owned_elsewhere: ${connectionId} folded ${domain}, already owned by another organization`,
    );
  }
  if (ownership.holders.some((holder) => holder.connectionId === connectionId)) return;
  if (ownership.holders.length === 0) {
    await tx.ssoVerifiedDomainHolder.create({ data: { domain, connectionId, organizationId } });
    return;
  }
  const existingConnectionId = ownership.holders[0]?.connectionId;
  if (ownership.holders.length > 1 || existingConnectionId === undefined) {
    throw new Error(`sso_domain_replacement_pair_full: ${connectionId} cannot hold ${domain}`);
  }

  const pair = await tx.ssoConnection.findMany({
    where: { id: { in: [existingConnectionId, connectionId] } },
    select: { id: true, organizationId: true, replacesConnectionId: true },
  });
  const existing = pair.find((connection) => connection.id === existingConnectionId);
  const incoming = pair.find((connection) => connection.id === connectionId);
  if (!existing || !incoming || !verifiedDomainCanBeShared({ existing, incoming })) {
    throw new Error(
      `sso_domain_replacement_mismatch: ${connectionId} cannot share ${domain} with ${existingConnectionId}`,
    );
  }
  await tx.ssoVerifiedDomainHolder.create({ data: { domain, connectionId, organizationId } });
}
