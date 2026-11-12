// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type {
  NurturingTracedProjectRepository,
  NurturingTracedProjectRow,
} from "../nurturing-traced-project.repository.ts";

/** The Postgres twin's semantics: one row per project, the first write kept. */
export class MemoryNurturingTracedProjectRepository implements NurturingTracedProjectRepository {
  readonly #rows = new Map<string, NurturingTracedProjectRow>();

  static create(): MemoryNurturingTracedProjectRepository {
    return new MemoryNurturingTracedProjectRepository();
  }

  async recordTraced(input: NurturingTracedProjectRow): Promise<void> {
    if (!this.#rows.has(input.projectId)) this.#rows.set(input.projectId, { ...input });
  }

  async hasTraced({ organizationId }: Readonly<{ organizationId: string }>): Promise<boolean> {
    return [...this.#rows.values()].some((row) => row.organizationId === organizationId);
  }

  /** Every stored row in write order, for a test to read what the copy holds. */
  storedRows(): NurturingTracedProjectRow[] {
    return [...this.#rows.values()];
  }
}
