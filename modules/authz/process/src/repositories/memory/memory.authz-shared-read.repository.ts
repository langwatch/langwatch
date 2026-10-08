import { PROJECT_READER_ROLE_KEY } from "@langwatch/authz-contract";

import {
  AuthzSharedReadRepository,
  type SharedReadGrant,
  type SharedReadRow,
} from "../authz-shared-read.repository.ts";
import { grantConditionFieldFromDb } from "../prisma/prisma.authz-grant.mapper.ts";
import type { AuthzMemoryGrantRow, AuthzMemoryStore } from "./authz-memory.store.ts";

/** The shared reads over the memory Grant head, with the Prisma backend's filters (ADR-175). */
export class MemoryAuthzSharedReadRepository extends AuthzSharedReadRepository {
  static create(options: { memory: AuthzMemoryStore }): MemoryAuthzSharedReadRepository {
    return new MemoryAuthzSharedReadRepository(options.memory);
  }

  private constructor(private readonly memory: AuthzMemoryStore) {
    super();
  }

  async findLiveSharedReads({
    organizationId,
    readerProjectId,
  }: {
    organizationId: string;
    readerProjectId: string;
  }): Promise<SharedReadRow[]> {
    return this.liveSharedReadsOf({ organizationId, readerProjectId }).flatMap((row) => {
      const { condition } = grantConditionFieldFromDb(row.condition);
      if (!condition) return [];
      return [
        {
          grantId: row.id,
          memberProjectId: row.scopeId,
          condition,
          expiresAt: row.expiresAt,
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
    return this.liveSharedReadsOf({ organizationId, readerProjectId })
      .filter((row) => memberProjectIds === undefined || memberProjectIds.includes(row.scopeId))
      .toSorted((a, b) => a.scopeId.localeCompare(b.scopeId))
      .map((row) => ({ grantId: row.id, memberProjectId: row.scopeId }));
  }

  async findGrantStates({
    organizationId,
    grantIds,
  }: {
    organizationId: string;
    grantIds: readonly string[];
  }): Promise<{ grantId: string; isRevoked: boolean }[]> {
    return this.memory.grants
      .filter((row) => row.organizationId === organizationId && grantIds.includes(row.id))
      .map((row) => ({ grantId: row.id, isRevoked: row.revokedAt !== null }));
  }

  private liveSharedReadsOf({
    organizationId,
    readerProjectId,
  }: {
    organizationId: string;
    readerProjectId: string;
  }): AuthzMemoryGrantRow[] {
    return this.memory.grants.filter(
      (row) =>
        row.revokedAt === null &&
        row.organizationId === organizationId &&
        row.principalType === "PROJECT" &&
        row.principalId === readerProjectId &&
        row.scopeType === "PROJECT" &&
        row.roleKey === PROJECT_READER_ROLE_KEY,
    );
  }
}
