// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { OrganizationMemberSeats } from "@langwatch/organization-contract";

import type { ScimSeatRepository } from "../scim-seat.repository.ts";

/** Holds no seats for any organization. */
export class MemoryScimSeatRepository implements ScimSeatRepository {
  static create(): MemoryScimSeatRepository {
    return new MemoryScimSeatRepository();
  }

  private constructor() {}

  async countMemberSeats(
    _input: Readonly<{ organizationId: string }>,
  ): Promise<OrganizationMemberSeats> {
    return { fullMembers: 0, liteMembers: 0, developers: 0 };
  }
}
