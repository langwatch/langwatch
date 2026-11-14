// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type {
  NurturingMembership,
  NurturingMembershipChange,
} from "../../rules/nurturing-organization-member.rules.ts";
import type { NurturingOrganizationMemberRepository } from "../nurturing-organization-member.repository.ts";

const COLUMN = { joined: "joinedAt", left: "leftAt", returned: "returnedAt" } as const;

/** The Postgres twin's semantics: each change keeps its latest time. */
export class MemoryNurturingOrganizationMemberRepository implements NurturingOrganizationMemberRepository {
  static create(): MemoryNurturingOrganizationMemberRepository {
    return new MemoryNurturingOrganizationMemberRepository();
  }

  readonly #memberships = new Map<string, NurturingMembership>();

  private constructor() {}

  async recordMembershipChange({
    organizationId,
    userId,
    change,
    at,
  }: Readonly<{
    organizationId: string;
    userId: string;
    change: NurturingMembershipChange;
    at: number;
  }>): Promise<void> {
    const key = JSON.stringify([organizationId, userId]);
    const known = this.#memberships.get(key) ?? {
      organizationId,
      userId,
      joinedAt: null,
      leftAt: null,
      returnedAt: null,
    };
    const column = COLUMN[change];
    this.#memberships.set(key, { ...known, [column]: Math.max(known[column] ?? at, at) });
  }

  async forgetMember({ userId }: Readonly<{ userId: string }>): Promise<void> {
    for (const [key, membership] of this.#memberships) {
      if (membership.userId === userId) this.#memberships.delete(key);
    }
  }

  async findMembershipsOfMembers({
    organizationId,
  }: Readonly<{ organizationId: string }>): Promise<NurturingMembership[]> {
    const all = [...this.#memberships.values()];
    const members = new Set(
      all.filter((row) => row.organizationId === organizationId).map(({ userId }) => userId),
    );
    return all.filter(({ userId }) => members.has(userId));
  }
}
