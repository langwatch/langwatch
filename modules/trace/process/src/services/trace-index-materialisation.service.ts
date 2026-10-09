import { setTimeout as wait } from "node:timers/promises";

import type {
  TraceIndexMaterialisationRepository,
  UpdatedAtIndexMutation,
} from "../repositories/trace-index-materialisation.repository.ts";

const POLL_INTERVAL_MS = 30_000;

/** What the step saves after each poll and returns when the index is materialised. */
export type UpdatedAtIndexProgress = Readonly<{ mutationId: string | null; partsToDo: number }>;

/**
 * Waits on goose 00103's `idx_updated_at` materialisation over `trace_summaries`, so its
 * progress and failure reach the upgrade ledger. Starts it once when no mutation is recorded.
 */
export class TraceIndexMaterialisationService {
  private constructor(
    private readonly mutations: TraceIndexMaterialisationRepository,
    private readonly pollIntervalMs: number,
  ) {}

  static create({
    mutations,
    pollIntervalMs = POLL_INTERVAL_MS,
  }: {
    mutations: TraceIndexMaterialisationRepository;
    pollIntervalMs?: number;
  }): TraceIndexMaterialisationService {
    return new TraceIndexMaterialisationService(mutations, pollIntervalMs);
  }

  async waitForUpdatedAtIndex({
    dryRun,
    signal,
    onPoll,
  }: {
    dryRun: boolean;
    signal: AbortSignal;
    onPoll: (progress: UpdatedAtIndexProgress) => Promise<void>;
  }): Promise<UpdatedAtIndexProgress> {
    let started = false;
    let progress: UpdatedAtIndexProgress = { mutationId: null, partsToDo: 0 };
    for (let aborted = false; !aborted;) {
      const [latest] = await this.mutations.findUpdatedAtIndexMutations();
      if (!latest) {
        // Started and still unrecorded: the table has no such index, so nothing is left to build.
        if (dryRun || started) return { mutationId: null, partsToDo: 0 };
        await this.mutations.materialiseUpdatedAtIndex();
        started = true;
        continue;
      }
      progress = { mutationId: latest.mutationId, partsToDo: latest.partsToDo };
      if (latest.isDone) return progress;
      if (latest.latestFailReason) throw failedMaterialisation(latest);
      if (dryRun) return progress;
      await onPoll(progress);
      await wait(this.pollIntervalMs, undefined, { signal }).catch(() => undefined);
      aborted = signal.aborted;
    }
    return progress;
  }
}

function failedMaterialisation(mutation: UpdatedAtIndexMutation): Error {
  return new Error(
    `ClickHouse could not build the trace_summaries updated-at index (mutation ${mutation.mutationId}, ` +
      `${mutation.partsToDo} parts left): ${mutation.latestFailReason}. ` +
      "Fix the cause on the ClickHouse server, then retry this step.",
  );
}
