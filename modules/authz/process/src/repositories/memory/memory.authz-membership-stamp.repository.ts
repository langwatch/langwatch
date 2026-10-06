import {
  AuthzMembershipStampRepository,
  type MembershipStampRow,
} from "../authz-membership-stamp.repository.ts";
import type { AuthzMemoryStore } from "./authz-memory.store.ts";

/** The live memberships' generations; one process holds no row lock to take. */
export class MemoryAuthzMembershipStampRepository extends AuthzMembershipStampRepository {
  static create(options: { memory: AuthzMemoryStore }): MemoryAuthzMembershipStampRepository {
    return new MemoryAuthzMembershipStampRepository(options.memory);
  }

  private constructor(private readonly memory: AuthzMemoryStore) {
    super();
  }

  async findLockedStamps({
    organizationId,
    userIds,
  }: {
    organizationId: string;
    userIds: string[];
  }): Promise<MembershipStampRow[]> {
    return [...new Set(userIds)].flatMap((userId) => {
      const row = this.memory.membershipStamps.get(`${organizationId}:${userId}`);
      if (!row || row.disabled) return [];
      return [{ userId, membershipStamp: row.membershipStamp }];
    });
  }
}
