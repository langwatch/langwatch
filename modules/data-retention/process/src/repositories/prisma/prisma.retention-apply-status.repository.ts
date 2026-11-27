import type {
  ProjectionStoreContext,
  StoredProjection,
  StoredProjectionRead,
} from "@langwatch/eventing";
import { PrismaRepository } from "@langwatch/prisma-client";

import type { RetentionApplyStatusState } from "../../eventing/retention-apply-status.projection.ts";
import type { ScopeApplyRecord } from "../../rules/stored-apply-status.rules.ts";
import type { RetentionApplyStatusRepository } from "../retention-apply-status.repository.ts";

type Row = {
  organizationId: string;
  scopeType: RetentionApplyStatusState["scopeType"];
  scopeId: string;
  changedAt: number | null;
  appliedAt: number | null;
  raisedAt: number | null;
  shortenedAt: number | null;
  createdAt: number;
  updatedAt: number;
  occurredAt: number;
  acceptedAt: number;
  lastEventId: string;
  projectionVersion: string;
};

function fromRow(row: Row): StoredProjection<RetentionApplyStatusState> {
  return {
    state: {
      organizationId: row.organizationId,
      scopeType: row.scopeType,
      scopeId: row.scopeId,
      changedAt: row.changedAt,
      appliedAt: row.appliedAt,
      raisedAt: row.raisedAt,
      shortenedAt: row.shortenedAt,
    },
    cursor: { acceptedAt: row.acceptedAt, eventId: row.lastEventId },
    occurredAt: row.occurredAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    version: row.projectionVersion,
  };
}

/** Postgres rows of the status projection; the row id is the projection key. */
export class PrismaRetentionApplyStatusRepository
  extends PrismaRepository.for("RetentionApplyStatus")
  implements RetentionApplyStatusRepository
{
  static readonly create = this.factory(
    (prisma) => new PrismaRetentionApplyStatusRepository(prisma),
  );

  async get(key: string): Promise<StoredProjectionRead<RetentionApplyStatusState>> {
    const row = await this.prisma.retentionApplyStatus.findUnique({ where: { id: key } });
    return row ? { kind: "folded", projection: fromRow(row) } : { kind: "empty" };
  }

  async store(
    projection: StoredProjection<RetentionApplyStatusState>,
    context: ProjectionStoreContext,
  ): Promise<void> {
    const id = context.key ?? context.aggregateId;
    const { organizationId, scopeType, scopeId, changedAt, appliedAt, raisedAt, shortenedAt } =
      projection.state;
    const data = {
      changedAt,
      appliedAt,
      raisedAt,
      shortenedAt,
      createdAt: projection.createdAt,
      updatedAt: projection.updatedAt,
      occurredAt: projection.occurredAt,
      acceptedAt: projection.cursor.acceptedAt,
      lastEventId: projection.cursor.eventId,
      projectionVersion: projection.version,
    };
    await this.prisma.retentionApplyStatus.upsert({
      where: { id },
      create: { id, organizationId, scopeType, scopeId, ...data },
      update: data,
    });
  }

  async findForOrganization({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<ScopeApplyRecord[]> {
    return this.prisma.retentionApplyStatus.findMany({
      where: { organizationId },
      select: {
        scopeType: true,
        scopeId: true,
        changedAt: true,
        appliedAt: true,
        raisedAt: true,
        shortenedAt: true,
      },
    });
  }
}
