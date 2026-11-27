// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Nurturing's erasure marks (`NurturingErasedUser`): one per erased account, a hash of its id and
 * never the id. The member, organization, key and personal-owner copies, and every send to a
 * person, read them here.
 */
export interface NurturingErasedUserRepository {
  /** Marks the account erased; marking it again changes nothing. */
  markErased(input: Readonly<{ userId: string }>): Promise<void>;
  /** Which of the named people are marked erased, each once, in no particular order. */
  findErased(input: Readonly<{ userIds: readonly string[] }>): Promise<string[]>;
}
