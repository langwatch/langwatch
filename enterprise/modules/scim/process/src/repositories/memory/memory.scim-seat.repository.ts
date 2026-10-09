// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { OrganizationMemberSeats } from "@langwatch/organization-contract";

import type { ScimSeatRepository } from "../scim-seat.repository.ts";

/** The seat counts a test recorded; an organization nobody recorded holds no seats. */
export class MemoryScimSeatRepository implements ScimSeatRepository {
  readonly #seats = new Map<string, OrganizationMemberSeats>();

  static create(): MemoryScimSeatRepository {
    return new MemoryScimSeatRepository();
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
