import { setTimeout as wait } from "node:timers/promises";

import { z } from "zod";

import type {
  BillableEventsTtlRepository,
  TtlMutation,
} from "../repositories/billable-events-ttl.repository.ts";

const POLL_INTERVAL_MS = 30_000;

/** What the step saves after each poll and returns once the TTL is applied. */
export const ttlProgressSchema = z.object({
  mutationId: z.string().nullable(),
  partsToDo: z.number(),
  /** True once this step started the materialisation: a resumed run never starts a second. */
  started: z.boolean(),
});
export type TtlProgress = Readonly<z.infer<typeof ttlProgressSchema>>;

/**
 * Applies goose 00128's delete TTL to `billable_events` parts written before it: starts one
 * `MATERIALIZE TTL` when none is listed, then waits on it so its progress and failure reach the
 * upgrade ledger. Spec: modules/entitlement/specs/billable-events-retention-step.feature.
 */
export class BillableEventsTtlService {
  private constructor(
    private readonly mutations: BillableEventsTtlRepository,
    private readonly pollIntervalMs: number,
  ) {}

  static create({
    mutations,
    pollIntervalMs = POLL_INTERVAL_MS,
  }: {
    mutations: BillableEventsTtlRepository;
    pollIntervalMs?: number;
  }): BillableEventsTtlService {
    return new BillableEventsTtlService(mutations, pollIntervalMs);
  }

  async materialise({
    dryRun,
    resumed,
    signal,
    onPoll,
  }: {
    dryRun: boolean;
    resumed: TtlProgress | null;
    signal: AbortSignal;
    onPoll: (progress: TtlProgress) => Promise<void>;
  }): Promise<TtlProgress> {
    let started = resumed?.started ?? false;
    let progress: TtlProgress = { mutationId: null, partsToDo: 0, started };
    while (!signal.aborted) {
      const [latest] = await this.mutations.findTtlMutations();
      if (!latest) {
        // Listed while it runs: none after a start means ClickHouse finished and pruned it.
        if (dryRun || started) return progress;
        // Saved before the start, so a run stopped in between never starts a second rewrite.
        progress = { mutationId: null, partsToDo: 0, started: true };
        await onPoll(progress);
        await this.mutations.materialiseTtl();
        started = true;
        continue;
      }
      progress = { mutationId: latest.mutationId, partsToDo: latest.partsToDo, started };
      if (latest.isDone) return progress;
      if (latest.latestFailReason) throw failedMaterialisation(latest);
      if (dryRun) return progress;
      await onPoll(progress);
      await wait(this.pollIntervalMs, undefined, { signal }).catch(() => undefined);
    }
    return progress;
  }
}

function failedMaterialisation(mutation: TtlMutation): Error {
  return new Error(
    `ClickHouse could not apply the billable_events retention TTL (mutation ${mutation.mutationId}, ` +
      `${mutation.partsToDo} parts left): ${mutation.latestFailReason}. ` +
      "Fix the cause on the ClickHouse server, then retry this step.",
  );
}
