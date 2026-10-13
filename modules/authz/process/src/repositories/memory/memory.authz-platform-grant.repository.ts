import {
  PLATFORM_OPERATOR_ROLE_ID,
  PLATFORM_TENANT_ID,
  type PlatformOperator,
} from "@langwatch/authz-contract";
import { nowInstant } from "@langwatch/time";

import { AuthzPlatformGrantRepository } from "../authz-platform-grant.repository.ts";
import type { AuthzMemoryStore } from "./authz-memory.store.ts";

/** The platform tier read off the memory Grant head, with the Prisma read's filters. */
export class MemoryAuthzPlatformGrantRepository extends AuthzPlatformGrantRepository {
  static create(options: { memory: AuthzMemoryStore }): MemoryAuthzPlatformGrantRepository {
    return new MemoryAuthzPlatformGrantRepository(options.memory);
  }

  private constructor(private readonly memory: AuthzMemoryStore) {
    super();
  }

  async findGrants({
    grantId,
    userId,
  }: {
    grantId?: string;
    userId?: string;
  }): Promise<PlatformOperator[]> {
    const nowMs = nowInstant().epochMilliseconds;
    return this.memory.grants
      .filter(
        (row) =>
          row.revokedAt === null &&
          row.organizationId === PLATFORM_TENANT_ID &&
          row.scopeType === "PLATFORM" &&
          row.scopeId === PLATFORM_TENANT_ID &&
          row.principalType === "USER" &&
          row.roleKey === PLATFORM_OPERATOR_ROLE_ID &&
          (grantId === undefined || row.id === grantId) &&
          (userId === undefined || row.principalId === userId) &&
          (row.expiresAt === null || row.expiresAt.epochMilliseconds > nowMs),
      )
      .toSorted((a, b) => a.occurredAt.epochMilliseconds - b.occurredAt.epochMilliseconds)
      .flatMap((row) =>
        row.principalId === null
          ? []
          : [{ grantId: row.id, userId: row.principalId, grantedAt: row.occurredAt }],
      );
  }
}
