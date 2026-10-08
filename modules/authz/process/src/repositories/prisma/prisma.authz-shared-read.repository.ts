import { PROJECT_READER_ROLE_KEY, STORED_PRINCIPAL_KIND } from "@langwatch/authz-contract";
import { fromDate } from "@langwatch/time";

import type { AuthzDatabase } from "../authz-read.repository.ts";
import {
  AuthzSharedReadRepository,
  type SharedReadGrant,
  type SharedReadRow,
} from "../authz-shared-read.repository.ts";
import { liveGrants } from "../eventing/eventing.authz-live-rows.mapper.ts";
import { grantConditionFieldFromDb } from "./prisma.authz-grant.mapper.ts";

/** The rows that are one reader project's shared reads, spelled once for every query here. */
function sharedProjectReadsOf({
  organizationId,
  readerProjectId,
}: {
  organizationId: string;
  readerProjectId: string;
}) {
  return {
    organizationId,
    principalType: STORED_PRINCIPAL_KIND.project,
    principalId: readerProjectId,
    scopeType: "PROJECT" as const,
    roleKey: PROJECT_READER_ROLE_KEY,
  };
}

/** The shared reads over the Grant head (ADR-175). */
export class PrismaAuthzSharedReadRepository extends AuthzSharedReadRepository {
  static create({
    database,
  }: Readonly<{ database: Pick<AuthzDatabase, "grant"> }>): PrismaAuthzSharedReadRepository {
    return new PrismaAuthzSharedReadRepository(database);
  }

  private constructor(private readonly database: Pick<AuthzDatabase, "grant">) {
    super();
  }

  async findLiveSharedReads({
    organizationId,
    readerProjectId,
  }: {
    organizationId: string;
    readerProjectId: string;
  }): Promise<SharedReadRow[]> {
    const rows = (await liveGrants(this.database).findMany({
      where: sharedProjectReadsOf({ organizationId, readerProjectId }),
      select: { id: true, scopeId: true, condition: true, expiresAt: true },
    })) as { id: string; scopeId: string; condition: unknown; expiresAt: Date | null }[];
    return rows.flatMap((row) => {
      const { condition } = grantConditionFieldFromDb(row.condition);
      if (!condition) return [];
      return [
        {
          grantId: row.id,
          memberProjectId: row.scopeId,
          condition,
          expiresAt: row.expiresAt ? fromDate(row.expiresAt) : null,
        },
      ];
    });
  }

  async findLiveSharedReadGrants({
    organizationId,
    readerProjectId,
    memberProjectIds,
  }: {
    organizationId: string;
    readerProjectId: string;
    memberProjectIds?: readonly string[];
  }): Promise<SharedReadGrant[]> {
    const rows = (await liveGrants(this.database).findMany({
      where: {
        ...sharedProjectReadsOf({ organizationId, readerProjectId }),
        ...(memberProjectIds !== undefined ? { scopeId: { in: [...memberProjectIds] } } : {}),
      },
      select: { id: true, scopeId: true },
      orderBy: { scopeId: "asc" },
    })) as { id: string; scopeId: string }[];
    return rows.map((row) => ({ grantId: row.id, memberProjectId: row.scopeId }));
  }

  async findGrantStates({
    organizationId,
    grantIds,
  }: {
    organizationId: string;
    grantIds: readonly string[];
  }): Promise<{ grantId: string; isRevoked: boolean }[]> {
    if (grantIds.length === 0) return [];
    const rows = (await this.database.grant.findMany({
      where: { organizationId, id: { in: [...grantIds] } },
      select: { id: true, revokedAt: true },
    })) as { id: string; revokedAt: Date | null }[];
    return rows.map((row) => ({ grantId: row.id, isRevoked: row.revokedAt !== null }));
  }
}
