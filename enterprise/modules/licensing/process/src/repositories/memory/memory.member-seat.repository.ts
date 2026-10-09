import type { OrganizationMemberSeats } from "@langwatch/organization-contract";

import type { MemberSeatRepository } from "../member-seat.repository.ts";

/** The seat counts a test recorded; an organization nobody recorded holds no seats. */
export class MemoryMemberSeatRepository implements MemberSeatRepository {
  readonly #seats = new Map<string, OrganizationMemberSeats>();

  static create(): MemoryMemberSeatRepository {
    return new MemoryMemberSeatRepository();
  }

  private constructor() {}

  record({
    organizationId,
    seats,
  }: Readonly<{ organizationId: string; seats: OrganizationMemberSeats }>): void {
    this.#seats.set(organizationId, seats);
  }

  async countMemberSeats({
    organizationId,
  }: Readonly<{ organizationId: string }>): Promise<OrganizationMemberSeats> {
    return this.#seats.get(organizationId) ?? { fullMembers: 0, liteMembers: 0, developers: 0 };
  }
}
