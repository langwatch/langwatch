import { nowInstant, Temporal } from "@langwatch/time";

import {
  type AuthzRevocationMark,
  AuthzRevocationRepository,
  type AuthzRoleDeletionMark,
} from "../authz-revocation.repository.ts";
import type { AuthzMemoryStore } from "./authz-memory.store.ts";

/** The synchronous deny over the memory Grant head, with the Prisma mark's guards. */
export class MemoryAuthzRevocationRepository extends AuthzRevocationRepository {
  static create(options: { memory: AuthzMemoryStore }): MemoryAuthzRevocationRepository {
    return new MemoryAuthzRevocationRepository(options.memory);
  }

  private constructor(private readonly memory: AuthzMemoryStore) {
    super();
  }

  protected async markRevoked({
    organizationId,
    grantIds,
    revokedAt,
    revokedReason,
  }: AuthzRevocationMark): Promise<void> {
    const at = Temporal.Instant.fromEpochMilliseconds(revokedAt.epochMilliseconds);
    const updatedAt = Temporal.Instant.fromEpochMilliseconds(nowInstant().epochMilliseconds);
    for (const row of this.memory.grants) {
      if (row.organizationId !== organizationId || row.revokedAt !== null) continue;
      if (!grantIds.includes(row.id)) continue;
      row.revokedAt = at;
      row.revokedReason = revokedReason;
      row.updatedAt = updatedAt;
    }
  }

  protected async markRoleDeleted({
    organizationId,
    roleId,
    deletedAt,
  }: AuthzRoleDeletionMark): Promise<void> {
    const at = Temporal.Instant.fromEpochMilliseconds(deletedAt.epochMilliseconds);
    const row = this.memory.roleHeads.find(
      (stored) =>
        stored.id === roleId &&
        stored.organizationId === organizationId &&
        stored.deletedAt === null &&
        stored.occurredAt.epochMilliseconds <= at.epochMilliseconds,
    );
    if (!row) return;
    row.deletedAt = at;
    row.occurredAt = at;
    row.updatedAt = Temporal.Instant.fromEpochMilliseconds(nowInstant().epochMilliseconds);
  }
}
