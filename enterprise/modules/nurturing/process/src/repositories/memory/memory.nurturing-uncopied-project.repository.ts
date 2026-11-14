// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { NurturingUncopiedProjectRepository } from "../nurturing-uncopied-project.repository.ts";

/** The Postgres twin's semantics: one first-seen time per project, the first write kept. */
export class MemoryNurturingUncopiedProjectRepository implements NurturingUncopiedProjectRepository {
  readonly #firstSeenAt = new Map<string, number>();

  static create(): MemoryNurturingUncopiedProjectRepository {
    return new MemoryNurturingUncopiedProjectRepository();
  }

  async firstSeenAt({
    projectId,
    seenAt,
  }: Readonly<{ projectId: string; seenAt: number }>): Promise<number> {
    const stored = this.#firstSeenAt.get(projectId);
    if (stored !== undefined) return stored;
    this.#firstSeenAt.set(projectId, seenAt);
    return seenAt;
  }

  async forget({ projectId }: Readonly<{ projectId: string }>): Promise<void> {
    this.#firstSeenAt.delete(projectId);
  }

  /** Every project with a stored row, for a test to read what the record holds. */
  storedProjectIds(): string[] {
    return [...this.#firstSeenAt.keys()];
  }
}
