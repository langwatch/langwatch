// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { NurturingSignal } from "@langwatch/enterprise-nurturing-contract";

import type { NurturingErasedUserRepository } from "../repositories/nurturing-erased-user.repository.ts";

type ErasureMarks = Pick<NurturingErasedUserRepository, "findErased">;

/**
 * Who of a signal's people erasure marked, read before any claim, so a failed read fails the
 * delivery and its retry acts.
 */
export class NurturingErasedPeopleService {
  static create(erasedUsers: ErasureMarks): NurturingErasedPeopleService {
    return new NurturingErasedPeopleService(erasedUsers);
  }

  private constructor(private readonly erasedUsers: ErasureMarks) {}

  /** Whether erasure marked this one person. */
  async isErased(userId: string): Promise<boolean> {
    const [erased] = await this.erasedUsers.findErased({ userIds: [userId] });
    return erased !== undefined;
  }

  /**
   * The signal without the people erasure marked: a marked member leaves its members, and a marked
   * subject (its `userId`) is reported so nothing is sent to them. One read for all of them.
   */
  async withoutErasedPeople(
    signal: NurturingSignal,
  ): Promise<{ signal: NurturingSignal; subjectErased: boolean }> {
    const subject = "userId" in signal ? [signal.userId] : [];
    const members = "memberUserIds" in signal ? signal.memberUserIds : [];
    const named = [...subject, ...members];
    if (named.length === 0) return { signal, subjectErased: false };
    const erased = new Set(await this.erasedUsers.findErased({ userIds: named }));
    if (erased.size === 0) return { signal, subjectErased: false };
    return {
      signal:
        "memberUserIds" in signal
          ? { ...signal, memberUserIds: signal.memberUserIds.filter((id) => !erased.has(id)) }
          : signal,
      subjectErased: subject.some((id) => erased.has(id)),
    };
  }
}
