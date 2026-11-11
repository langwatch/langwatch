// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  retriesUncopiedProject,
  type UncopiedProjectOutcome,
} from "../rules/nurturing-project-usage.rules.ts";

const DEFAULT_MAX_ENTRIES = 5000;

/**
 * The projects whose trace batches ran out of retries with no placement copy, in a bounded
 * per-process LRU set: their later batches drop at once. Asked only for a project with no copy, so
 * a copy that lands later counts the project again whatever the set holds.
 */
export class NurturingUncopiedProjectsService {
  static create({
    maxEntries = DEFAULT_MAX_ENTRIES,
  }: Readonly<{ maxEntries?: number }> = {}): NurturingUncopiedProjectsService {
    return new NurturingUncopiedProjectsService(maxEntries);
  }

  readonly #dropped = new Set<string>();
  readonly #maxEntries: number;

  private constructor(maxEntries: number) {
    this.#maxEntries = maxEntries;
  }

  /** A batch of `projectId`, which has no placement copy, on the queue's `deliveryAttempt`. */
  outcomeOf({
    projectId,
    deliveryAttempt,
  }: Readonly<{ projectId: string; deliveryAttempt?: number }>): UncopiedProjectOutcome {
    if (this.#dropped.delete(projectId)) {
      this.#dropped.add(projectId);
      return "drop";
    }
    if (retriesUncopiedProject({ deliveryAttempt })) return "retry";
    if (this.#dropped.size >= this.#maxEntries) {
      const oldest = this.#dropped.values().next().value;
      if (oldest !== undefined) this.#dropped.delete(oldest);
    }
    this.#dropped.add(projectId);
    return "drop";
  }
}
