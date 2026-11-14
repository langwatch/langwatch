// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type {
  NurturingPersonalProjectRepository,
  NurturingPersonalProjectRow,
} from "../nurturing-personal-project.repository.ts";

/** The Postgres twin's semantics: one row per project, the first write kept. */
export class MemoryNurturingPersonalProjectRepository implements NurturingPersonalProjectRepository {
  readonly #rows = new Map<string, NurturingPersonalProjectRow>();

  static create(): MemoryNurturingPersonalProjectRepository {
    return new MemoryNurturingPersonalProjectRepository();
  }

  async recordOwner(input: NurturingPersonalProjectRow): Promise<void> {
    if (!this.#rows.has(input.projectId)) this.#rows.set(input.projectId, { ...input });
  }

  async findOwnerUserIds({ projectId }: Readonly<{ projectId: string }>): Promise<string[]> {
    const row = this.#rows.get(projectId);
    return row ? [row.ownerUserId] : [];
  }

  async forgetOwner({ ownerUserId }: Readonly<{ ownerUserId: string }>): Promise<void> {
    for (const [projectId, row] of this.#rows) {
      if (row.ownerUserId === ownerUserId) this.#rows.delete(projectId);
    }
  }

  /** Every stored row in write order, for a test to read what the copy holds. */
  storedRows(): NurturingPersonalProjectRow[] {
    return [...this.#rows.values()];
  }
}
