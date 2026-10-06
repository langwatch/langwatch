/**
 * The cancellation hint held in this process alone: what a deployment with no
 * Redis gets, where a run stops one page later off its recorded cancellation,
 * and what a suite drives the executor's stop path with.
 */

import type { InstantEvalCancellationRepository } from "../instant-eval-cancellation.repository.ts";

export class MemoryInstantEvalCancellationRepository implements InstantEvalCancellationRepository {
  #requested = new Set<string>();

  private constructor() {}

  static create(): MemoryInstantEvalCancellationRepository {
    return new MemoryInstantEvalCancellationRepository();
  }

  async request({ runId }: { runId: string }): Promise<void> {
    this.#requested.add(runId);
  }

  async isRequested({ runId }: { runId: string }): Promise<boolean> {
    return this.#requested.has(runId);
  }
}
