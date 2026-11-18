// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type {
  NurturingMemberSourceRepository,
  NurturingSourceMember,
} from "../nurturing-member-source.repository.ts";

/** Holds the active members it is given; a composition over memory stores has none. */
export class MemoryNurturingMemberSourceRepository implements NurturingMemberSourceRepository {
  static create({
    membersByOrganization = {},
  }: Readonly<{
    membersByOrganization?: Readonly<Record<string, readonly NurturingSourceMember[]>>;
  }> = {}): MemoryNurturingMemberSourceRepository {
    return new MemoryNurturingMemberSourceRepository(membersByOrganization);
  }

  private constructor(
    private readonly membersByOrganization: Readonly<
      Record<string, readonly NurturingSourceMember[]>
    >,
  ) {}

  async findOrganizationIds({
    after,
    limit,
  }: Readonly<{ after?: string; limit: number }>): Promise<string[]> {
    return Object.keys(this.membersByOrganization)
      .toSorted()
      .filter((id) => after === undefined || id > after)
      .slice(0, limit);
  }

  async findActiveMembers({
    organizationId,
  }: Readonly<{ organizationId: string }>): Promise<NurturingSourceMember[]> {
    return [...(this.membersByOrganization[organizationId] ?? [])];
  }
}
