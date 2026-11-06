import type { OrganizationMemberSeats } from "@langwatch/organization-contract";

import type { MemberSeatRepository } from "../member-seat.repository.ts";
import type { MemoryEntitlementDatabase } from "./memory.entitlement.database.ts";

/** The seat counts a test recorded; an organization nobody recorded holds no seats. */
export class MemoryMemberSeatRepository implements MemberSeatRepository {
  #database: MemoryEntitlementDatabase;

  private constructor(database: MemoryEntitlementDatabase) {
    this.#database = database;
  }

  static create(
    input: Readonly<{ memory: MemoryEntitlementDatabase }>,
  ): MemoryMemberSeatRepository {
    return new MemoryMemberSeatRepository(input.memory);
  }

  async countMemberSeats({
    organizationId,
  }: Readonly<{ organizationId: string }>): Promise<OrganizationMemberSeats> {
    const usage = this.#database.find(organizationId);
    return {
      fullMembers: usage?.memberCount ?? 0,
      liteMembers: usage?.membersLiteCount ?? 0,
      developers: usage?.developerCount ?? 0,
    };
  }
}
