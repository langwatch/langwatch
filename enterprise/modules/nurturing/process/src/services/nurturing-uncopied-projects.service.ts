// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { NurturingUncopiedProjectRepository } from "../repositories/nurturing-uncopied-project.repository.ts";
import {
  retriesUncopiedProject,
  type UncopiedProjectOutcome,
} from "../rules/nurturing-project-usage.rules.ts";

const DEFAULT_MAX_ENTRIES = 5000;

type UncopiedProjectsDependencies = Readonly<{
  uncopiedProjects: NurturingUncopiedProjectRepository;
  clock: Readonly<{ nowMs: () => number }>;
  maxEntries?: number;
}>;

/**
 * Projects nurturing sees traces of with no placement copy. Each retries within one window from
 * when any worker first saw it (a shared row), then drops; a dropped project is cached in a bounded
 * per-process LRU set, so its later batches drop with no read. A landed copy forgets the project.
 */
export class NurturingUncopiedProjectsService {
  static create({
    uncopiedProjects,
    clock,
    maxEntries = DEFAULT_MAX_ENTRIES,
  }: UncopiedProjectsDependencies): NurturingUncopiedProjectsService {
    return new NurturingUncopiedProjectsService(uncopiedProjects, clock, maxEntries);
  }

  readonly #dropped = new Set<string>();

  private constructor(
    private readonly uncopiedProjects: NurturingUncopiedProjectRepository,
    private readonly clock: UncopiedProjectsDependencies["clock"],
    private readonly maxEntries: number,
  ) {}

  /** Whether this process already dropped the project; a hit counts as its latest use. */
  isDropped({ projectId }: Readonly<{ projectId: string }>): boolean {
    if (!this.#dropped.delete(projectId)) return false;
    this.#dropped.add(projectId);
    return true;
  }

  /** A batch of `projectId`, which has no placement copy: retried inside its window, else dropped. */
  async outcomeOf({ projectId }: Readonly<{ projectId: string }>): Promise<UncopiedProjectOutcome> {
    const now = this.clock.nowMs();
    const firstSeenAt = await this.uncopiedProjects.firstSeenAt({ projectId, seenAt: now });
    if (retriesUncopiedProject({ firstSeenAt, now })) return "retry";
    if (this.#dropped.size >= this.maxEntries) {
      const oldest = this.#dropped.values().next().value;
      if (oldest !== undefined) this.#dropped.delete(oldest);
    }
    this.#dropped.add(projectId);
    return "drop";
  }

  /** The project's placement copy was written: its traces count from now on. */
  async copyLanded({ projectId }: Readonly<{ projectId: string }>): Promise<void> {
    await this.uncopiedProjects.forget({ projectId });
    this.#dropped.delete(projectId);
  }
}
