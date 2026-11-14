// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { NurturingUncopiedProjectRepository } from "../repositories/nurturing-uncopied-project.repository.ts";
import {
  retriesUncopiedProject,
  UNCOPIED_PROJECT_DROP_CACHE_TTL_MS,
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
 * when any worker first saw it (a shared row), then drops; a drop is cached in a bounded per-process
 * LRU for a TTL, so later batches drop with no read and a copy another worker wrote is still seen.
 */
export class NurturingUncopiedProjectsService {
  static create({
    uncopiedProjects,
    clock,
    maxEntries = DEFAULT_MAX_ENTRIES,
  }: UncopiedProjectsDependencies): NurturingUncopiedProjectsService {
    return new NurturingUncopiedProjectsService(uncopiedProjects, clock, maxEntries);
  }

  /** Each dropped project and when it was dropped, least recently used first. */
  readonly #dropped = new Map<string, number>();

  private constructor(
    private readonly uncopiedProjects: NurturingUncopiedProjectRepository,
    private readonly clock: UncopiedProjectsDependencies["clock"],
    private readonly maxEntries: number,
  ) {}

  /** Whether this process dropped the project within the TTL; a hit counts as its latest use. */
  isDropped({ projectId }: Readonly<{ projectId: string }>): boolean {
    const droppedAt = this.#dropped.get(projectId);
    if (droppedAt === undefined) return false;
    this.#dropped.delete(projectId);
    if (this.clock.nowMs() - droppedAt >= UNCOPIED_PROJECT_DROP_CACHE_TTL_MS) return false;
    this.#dropped.set(projectId, droppedAt);
    return true;
  }

  /** A batch of `projectId`, which has no placement copy: retried inside its window, else dropped. */
  async outcomeOf({ projectId }: Readonly<{ projectId: string }>): Promise<UncopiedProjectOutcome> {
    const now = this.clock.nowMs();
    const firstSeenAt = await this.uncopiedProjects.firstSeenAt({ projectId, seenAt: now });
    if (retriesUncopiedProject({ firstSeenAt, now })) return "retry";
    if (this.#dropped.size >= this.maxEntries) {
      const oldest = this.#dropped.keys().next().value;
      if (oldest !== undefined) this.#dropped.delete(oldest);
    }
    this.#dropped.set(projectId, now);
    return "drop";
  }

  /** The project's placement copy was written: its traces count from now on. */
  async copyLanded({ projectId }: Readonly<{ projectId: string }>): Promise<void> {
    await this.uncopiedProjects.forget({ projectId });
    this.#dropped.delete(projectId);
  }
}
