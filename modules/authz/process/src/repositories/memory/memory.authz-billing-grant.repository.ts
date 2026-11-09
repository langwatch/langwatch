import { BILLING_ROLE_KEY } from "@langwatch/authz-contract";
import { nowInstant } from "@langwatch/time";

import {
  AuthzBillingGrantRepository,
  type BillingGrantRow,
} from "../authz-billing-grant.repository.ts";
import type { AuthzMemoryStore } from "./authz-memory.store.ts";

/** The Billing role read off the memory Grant head, with the Prisma read's filters. */
export class MemoryAuthzBillingGrantRepository extends AuthzBillingGrantRepository {
  static create(options: { memory: AuthzMemoryStore }): MemoryAuthzBillingGrantRepository {
    return new MemoryAuthzBillingGrantRepository(options.memory);
  }

  private constructor(private readonly memory: AuthzMemoryStore) {
    super();
  }

  async findGrants({
    organizationId,
    userId,
  }: {
    organizationId: string;
    userId?: string;
  }): Promise<BillingGrantRow[]> {
    const nowMs = nowInstant().epochMilliseconds;
    return this.memory.grants
      .filter(
        (row) =>
          row.revokedAt === null &&
          row.organizationId === organizationId &&
          row.scopeType === "ORGANIZATION" &&
          row.scopeId === organizationId &&
          row.principalType === "USER" &&
          row.roleKey === BILLING_ROLE_KEY &&
          (userId === undefined || row.principalId === userId) &&
          (row.expiresAt === null || row.expiresAt.epochMilliseconds > nowMs),
      )
      .toSorted((a, b) => a.occurredAt.epochMilliseconds - b.occurredAt.epochMilliseconds)
      .flatMap((row) =>
        row.principalId === null ? [] : [{ grantId: row.id, userId: row.principalId }],
      );
  }

  async findEnabledMemberIds({
    organizationId,
    userIds,
  }: {
    organizationId: string;
    userIds: readonly string[];
  }): Promise<string[]> {
    return userIds.filter((userId) => {
      const row = this.memory.memberships.get(this.memory.membershipKey(organizationId, userId));
      return row !== undefined && !row.disabled;
    });
  }
}
