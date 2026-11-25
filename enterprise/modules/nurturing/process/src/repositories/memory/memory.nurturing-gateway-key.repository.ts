// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  foldVirtualKeyFactWithoutErased,
  forgetPersonOnKey,
  type NurturingVirtualKey,
  type NurturingVirtualKeyFact,
} from "../../rules/nurturing-virtual-key.rules.ts";
import type { NurturingErasedUserRepository } from "../nurturing-erased-user.repository.ts";
import type { NurturingVirtualKeyRepository } from "../nurturing-gateway-key.repository.ts";
import { MemoryNurturingErasedUserRepository } from "./memory.nurturing-erased-user.repository.ts";

/** The Postgres twin's semantics: every fact folds in by the key copy's rules. */
export class MemoryNurturingVirtualKeyRepository implements NurturingVirtualKeyRepository {
  /** `erasedUsers` is the marks every memory copy of one composition shares. */
  static create({
    erasedUsers = MemoryNurturingErasedUserRepository.create(),
  }: Readonly<{
    erasedUsers?: NurturingErasedUserRepository;
  }> = {}): MemoryNurturingVirtualKeyRepository {
    return new MemoryNurturingVirtualKeyRepository(erasedUsers);
  }

  readonly #keys = new Map<string, NurturingVirtualKey>();
  readonly #erasedUsers: NurturingErasedUserRepository;

  private constructor(erasedUsers: NurturingErasedUserRepository) {
    this.#erasedUsers = erasedUsers;
  }

  async recordKeyFact({ fact }: Readonly<{ fact: NurturingVirtualKeyFact }>): Promise<void> {
    const named = [fact.actorUserId, fact.principalUserId].filter(
      (userId): userId is string => userId !== null,
    );
    const erased = new Set(await this.#erasedUsers.findErased({ userIds: named }));
    // Read after the marks, so no fact folded in meanwhile is lost.
    const held = this.#keys.get(fact.virtualKeyId) ?? null;
    // As the Postgres upsert: a key never moves organization, so another's fact changes nothing.
    if (held && held.organizationId !== fact.organizationId) return;
    const isErased = (userId: string) => erased.has(userId);
    this.#keys.set(fact.virtualKeyId, foldVirtualKeyFactWithoutErased({ held, fact, isErased }));
  }

  async findKey({
    organizationId,
    virtualKeyId,
  }: Readonly<{
    organizationId: string;
    virtualKeyId: string;
  }>): Promise<NurturingVirtualKey[]> {
    const key = this.#keys.get(virtualKeyId);
    return key?.organizationId === organizationId ? [key] : [];
  }

  async forgetUser({ userId }: Readonly<{ userId: string }>): Promise<void> {
    await this.#erasedUsers.markErased({ userId });
    for (const [virtualKeyId, key] of this.#keys) {
      this.#keys.set(virtualKeyId, forgetPersonOnKey({ key, userId }));
    }
  }
}
