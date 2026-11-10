import { setTimeout as wait } from "node:timers/promises";

import { z } from "zod";

import type {
  TraceIndexMaterialisationRepository,
  MaterialisationMutation,
} from "../repositories/trace-index-materialisation.repository.ts";

const POLL_INTERVAL_MS = 30_000;

/** What the step saves after each poll and returns when the materialisation is done. */
export const materialisationProgressSchema = z.object({
  mutationId: z.string().nullable(),
  partsToDo: z.number(),
});
export type MaterialisationProgress = Readonly<z.infer<typeof materialisationProgressSchema>>;

type WaitArguments = Readonly<{
  dryRun: boolean;
  /** A saved checkpoint says an earlier run already started the mutation: never start a second. */
  resumed: boolean;
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
 * Waits on the mutations goose starts (00103's `idx_updated_at`, 00125's metadata columns), so
 * their progress and failure reach the upgrade ledger. Starts one once when none is recorded and
 * the table does not already hold what it builds.
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

  async waitForUpdatedAtIndex(
    args: Omit<WaitArguments, "resumed">,
  ): Promise<MaterialisationProgress> {
    return this.waitFor({
      ...args,
      // A released step: it keeps main's restart on resume, tracked separately.
      resumed: false,
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
    resumed,
    signal,
    onPoll,
    materialisation,
  }: WaitArguments & { materialisation: Materialisation }): Promise<MaterialisationProgress> {
    const state: UnlistedState = { started: resumed, graceLeft: resumed ? 1 : Infinity };
    let progress: MaterialisationProgress = { mutationId: null, partsToDo: 0 };
    while (!signal.aborted) {
      const [latest] = await materialisation.find();
      if (!latest) {
        const outcome = await this.stepWhileUnlisted({
          dryRun,
          signal,
          onPoll,
          materialisation,
          state,
        });
        if (outcome === "done") return { mutationId: null, partsToDo: 0 };
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

  /** What to do when no mutation is listed: finish, or (after any start or wait) look again. */
  private async stepWhileUnlisted({
    dryRun,
    signal,
    onPoll,
    materialisation,
    state,
  }: Omit<WaitArguments, "resumed"> & {
    materialisation: Materialisation;
    state: UnlistedState;
  }): Promise<"done" | "again"> {
    if (await nothingLeft({ dryRun, started: state.started, materialisation })) return "done";
    if (!state.started) {
      // Saved before the start: if the run stops in between, the next one fails loudly for an
      // operator, never starts a second rewrite.
      await onPoll({ mutationId: null, partsToDo: 0 });
      await materialisation.start();
      state.started = true;
      return "again";
    }
    // A resumed run gets one poll of grace (a mutation started just before the abort may not be
    // listed yet); a fresh run has infinite grace and waits for as long as it takes.
    if (state.graceLeft === 0) throw unlistedMaterialisation({ builds: materialisation.builds });
    if (Number.isFinite(state.graceLeft)) state.graceLeft -= 1;
    await wait(this.pollIntervalMs, undefined, { signal }).catch(() => undefined);
    return "again";
  }
}

/** What one run has done while its mutation was not listed. */
type UnlistedState = { started: boolean; graceLeft: number };

/**
 * Nothing to start or wait on. A table that can say so is done once it holds the build, even
 * after a start whose mutation is not listed yet; one that cannot is done once started and still
 * unrecorded, since it had nothing to build.
 */
async function nothingLeft({
  dryRun,
  started,
  materialisation,
}: {
  dryRun: boolean;
  started: boolean;
  materialisation: Materialisation;
}): Promise<boolean> {
  if (dryRun) return true;
  if (!materialisation.built) return started;
  return materialisation.built();
}

function unlistedMaterialisation({ builds }: { builds: string }): Error {
  return new Error(
    `ClickHouse lists no mutation building ${builds} and parts still lack it; it was likely ` +
      "killed or pruned, or its start failed before ClickHouse listed it. An operator must check " +
      "system.mutations on every replica and " +
      "start the materialisation by hand if none is running, then retry this step from Ops > " +
      "Upgrades: the retry keeps this checkpoint, so it waits on that mutation and never starts " +
      "one itself.",
  );
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
