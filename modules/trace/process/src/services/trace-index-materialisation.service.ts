import { setTimeout as wait } from "node:timers/promises";

import type {
  TraceIndexMaterialisationRepository,
  MaterialisationMutation,
} from "../repositories/trace-index-materialisation.repository.ts";

const POLL_INTERVAL_MS = 30_000;

/** What the step saves after each poll and returns when the materialisation is done. */
export type MaterialisationProgress = Readonly<{ mutationId: string | null; partsToDo: number }>;

type WaitArguments = Readonly<{
  dryRun: boolean;
  signal: AbortSignal;
  onPoll: (progress: MaterialisationProgress) => Promise<void>;
}>;

/**
 * One materialisation: how to read its mutations, how to start it, and what it builds. `built`,
 * where the table can say so, tells a finished build whose mutation ClickHouse pruned from one
 * never started, so the step does not rewrite the whole table again.
 */
type Materialisation = Readonly<{
  find: () => Promise<MaterialisationMutation[]>;
  start: () => Promise<void>;
  builds: string;
  built?: () => Promise<boolean>;
}>;

/**
 * Waits on the ClickHouse mutations goose starts over the trace module's tables (00103's
 * `idx_updated_at` on `trace_summaries`, 00125's metadata columns on `trace_analytics`), so their
 * progress and failure reach the upgrade ledger. Starts one once when no mutation is recorded
 * and the table does not already hold what it builds.
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

  async waitForUpdatedAtIndex(args: WaitArguments): Promise<MaterialisationProgress> {
    return this.waitFor({
      ...args,
      materialisation: {
        find: () => this.mutations.findUpdatedAtIndexMutations(),
        start: () => this.mutations.materialiseUpdatedAtIndex(),
        builds: "the trace_summaries updated-at index",
      },
    });
  }

  async waitForAnalyticsMetadataColumns(args: WaitArguments): Promise<MaterialisationProgress> {
    return this.waitFor({
      ...args,
      materialisation: {
        find: () => this.mutations.findAnalyticsMetadataColumnMutations(),
        start: () => this.mutations.materialiseAnalyticsMetadataColumns(),
        builds: "the trace_analytics metadata columns",
        built: async () => (await this.mutations.countPartsMissingAnalyticsMetadataColumns()) === 0,
      },
    });
  }

  private async waitFor({
    dryRun,
    signal,
    onPoll,
    materialisation,
  }: WaitArguments & { materialisation: Materialisation }): Promise<MaterialisationProgress> {
    let started = false;
    let progress: MaterialisationProgress = { mutationId: null, partsToDo: 0 };
    while (!signal.aborted) {
      const [latest] = await materialisation.find();
      if (!latest) {
        // Started and still unrecorded: the table has nothing to build, so nothing is left.
        if (dryRun || started) return { mutationId: null, partsToDo: 0 };
        if (await materialisation.built?.()) return { mutationId: null, partsToDo: 0 };
        await materialisation.start();
        started = true;
        continue;
      }
      progress = { mutationId: latest.mutationId, partsToDo: latest.partsToDo };
      if (latest.isDone) return progress;
      if (latest.latestFailReason) {
        throw failedMaterialisation({ mutation: latest, builds: materialisation.builds });
      }
      if (dryRun) return progress;
      await onPoll(progress);
      await wait(this.pollIntervalMs, undefined, { signal }).catch(() => undefined);
    }
    return progress;
  }
}

function failedMaterialisation({
  mutation,
  builds,
}: {
  mutation: MaterialisationMutation;
  builds: string;
}): Error {
  return new Error(
    `ClickHouse could not build ${builds} (mutation ${mutation.mutationId}, ` +
      `${mutation.partsToDo} parts left): ${mutation.latestFailReason}. ` +
      "Fix the cause on the ClickHouse server, then retry this step.",
  );
}
