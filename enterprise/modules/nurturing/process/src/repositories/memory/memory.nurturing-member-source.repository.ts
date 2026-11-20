// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type {
  NurturingMemberSourceRepository,
  NurturingSourceMember,
} from "../nurturing-member-source.repository.ts";

/** Holds the non-disabled members it is given; a composition over memory stores has none. */
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

  async findActiveMembers({
    organizationId,
  }: Readonly<{ organizationId: string }>): Promise<NurturingSourceMember[]> {
    return [...(this.membersByOrganization[organizationId] ?? [])];
  }
}
