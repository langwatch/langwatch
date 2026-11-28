// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { NurturingErasedUserRepository } from "../nurturing-erased-user.repository.ts";
import type {
  NurturingPersonalProjectRepository,
  NurturingPersonalProjectRow,
} from "../nurturing-personal-project.repository.ts";
import { MemoryNurturingErasedUserRepository } from "./memory.nurturing-erased-user.repository.ts";

/** The Postgres twin's semantics: one row per project, the first kept; an erased owner, none. */
export class MemoryNurturingPersonalProjectRepository implements NurturingPersonalProjectRepository {
  readonly #rows = new Map<string, NurturingPersonalProjectRow>();
  readonly #erasedUsers: NurturingErasedUserRepository;

  /** `erasedUsers` is the marks every memory copy of one composition shares. */
  static create({
    erasedUsers = MemoryNurturingErasedUserRepository.create(),
  }: Readonly<{
    erasedUsers?: NurturingErasedUserRepository;
  }> = {}): MemoryNurturingPersonalProjectRepository {
    return new MemoryNurturingPersonalProjectRepository(erasedUsers);
  }

  private constructor(erasedUsers: NurturingErasedUserRepository) {
    this.#erasedUsers = erasedUsers;
  }

  async recordOwner(input: NurturingPersonalProjectRow): Promise<void> {
    const [erased] = await this.#erasedUsers.findErased({ userIds: [input.ownerUserId] });
    const known = this.#rows.get(input.projectId);
    // As Postgres's re-check does: a marked owner's row for this project goes.
    if (erased) {
      if (known?.ownerUserId === input.ownerUserId) this.#rows.delete(input.projectId);
      return;
    }
    if (!known) this.#rows.set(input.projectId, { ...input });
  }

  async findOwnerUserIds({ projectId }: Readonly<{ projectId: string }>): Promise<string[]> {
    const row = this.#rows.get(projectId);
    return row ? [row.ownerUserId] : [];
  }

  async forgetOwner({ ownerUserId }: Readonly<{ ownerUserId: string }>): Promise<void> {
    await this.#erasedUsers.markErased({ userId: ownerUserId });
    for (const [projectId, row] of this.#rows) {
      if (row.ownerUserId === ownerUserId) this.#rows.delete(projectId);
    }
  }

  /** Every stored row in write order, for a test to read what the copy holds. */
  storedRows(): NurturingPersonalProjectRow[] {
    return [...this.#rows.values()];
  }
}
