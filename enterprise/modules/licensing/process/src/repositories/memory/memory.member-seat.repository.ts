import type { OrganizationMemberSeats } from "@langwatch/organization-contract";

import type { MemberSeatRepository } from "../member-seat.repository.ts";

/** No organization holds seats in memory; seat counts come from the live tables. */
export class MemoryMemberSeatRepository implements MemberSeatRepository {
  static create(): MemoryMemberSeatRepository {
    return new MemoryMemberSeatRepository();
  }

  private constructor() {}

  async countMemberSeats(): Promise<OrganizationMemberSeats> {
    return { fullMembers: 0, liteMembers: 0, developers: 0 };
  }
}
