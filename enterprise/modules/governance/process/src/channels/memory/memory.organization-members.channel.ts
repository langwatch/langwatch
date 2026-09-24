// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { OrganizationMembersChannel } from "../organization-members.channel.ts";

type MemoryMember = {
  organizationId: string;
  userId: string;
  name: string | null;
  email: string | null;
  emailVerified: boolean;
};

/** Members in memory, read the way the organization answers them. */
export class MemoryOrganizationMembersChannel implements OrganizationMembersChannel {
  private readonly members: MemoryMember[] = [];

  private constructor() {}

  static create(): MemoryOrganizationMembersChannel {
    return new MemoryOrganizationMembersChannel();
  }

  seed(member: MemoryMember): void {
    this.members.push(member);
  }

  async findVerifiedMemberEmails({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<{ userId: string; email: string }[]> {
    return this.members.flatMap((member) =>
      member.organizationId === organizationId && member.emailVerified && member.email
        ? [{ userId: member.userId, email: member.email }]
        : [],
    );
  }

  async findMemberNames({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<{ userId: string; name: string }[]> {
    return this.members.flatMap((member) => {
      if (member.organizationId !== organizationId) return [];
      const name = member.name ?? member.email;
      return name ? [{ userId: member.userId, name }] : [];
    });
  }
}
