// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { erasedUserHashOf } from "../../rules/nurturing-virtual-key.rules.ts";
import type { NurturingErasedUserRepository } from "../nurturing-erased-user.repository.ts";

/**
 * The Postgres twin's semantics: one mark per erased account, by its hash. One instance is given
 * to every memory copy that reads the marks, so they share one mark set, as they share the table.
 */
export class MemoryNurturingErasedUserRepository implements NurturingErasedUserRepository {
  static create(): MemoryNurturingErasedUserRepository {
    return new MemoryNurturingErasedUserRepository();
  }

  readonly #erasedUserHashes = new Set<string>();

  private constructor() {}

  async markErased({ userId }: Readonly<{ userId: string }>): Promise<void> {
    this.#erasedUserHashes.add(erasedUserHashOf(userId));
  }

  async findErased({ userIds }: Readonly<{ userIds: readonly string[] }>): Promise<string[]> {
    // Once each, as the Postgres read returns one row per mark.
    return [...new Set(userIds)].filter((userId) =>
      this.#erasedUserHashes.has(erasedUserHashOf(userId)),
    );
  }
}
