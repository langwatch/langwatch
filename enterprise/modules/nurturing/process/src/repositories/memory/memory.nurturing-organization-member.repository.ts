// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type {
  NurturingMembership,
  NurturingMembershipChange,
} from "../../rules/nurturing-organization-member.rules.ts";
import type { NurturingErasedUserRepository } from "../nurturing-erased-user.repository.ts";
import type { NurturingOrganizationMemberRepository } from "../nurturing-organization-member.repository.ts";
import { MemoryNurturingErasedUserRepository } from "./memory.nurturing-erased-user.repository.ts";

const COLUMN = { joined: "joinedAt", left: "leftAt", returned: "returnedAt" } as const;

/** The Postgres twin's semantics: each change keeps its latest time; an erased account, none. */
export class MemoryNurturingOrganizationMemberRepository implements NurturingOrganizationMemberRepository {
  /** `erasedUsers` is the marks every memory copy of one composition shares. */
  static create({
    erasedUsers = MemoryNurturingErasedUserRepository.create(),
  }: Readonly<{
    erasedUsers?: NurturingErasedUserRepository;
  }> = {}): MemoryNurturingOrganizationMemberRepository {
    return new MemoryNurturingOrganizationMemberRepository(erasedUsers);
  }

  readonly #memberships = new Map<string, NurturingMembership>();
  readonly #erasedUsers: NurturingErasedUserRepository;

  private constructor(erasedUsers: NurturingErasedUserRepository) {
    this.#erasedUsers = erasedUsers;
  }

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
    const [erased] = await this.#erasedUsers.findErased({ userIds: [userId] });
    // As Postgres's re-check does: a marked account's row in this organization goes.
    if (erased) {
      this.#memberships.delete(key);
      return;
    }
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
    await this.#erasedUsers.markErased({ userId });
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

  async findMembershipsOfUsers({
    userIds,
  }: Readonly<{ userIds: readonly string[] }>): Promise<NurturingMembership[]> {
    const named = new Set(userIds);
    return [...this.#memberships.values()].filter(({ userId }) => named.has(userId));
  }
}
