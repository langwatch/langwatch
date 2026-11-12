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
  /** True once this step issued, or was about to issue, `MATERIALIZE TTL`. */
  started: z.boolean(),
  /** True once ClickHouse accepted or listed the mutation; only then is an empty list done. */
  confirmed: z.boolean().default(false),
});
export type TtlProgress = Readonly<z.infer<typeof ttlProgressSchema>>;

/**
 * Applies goose 00128's delete TTL to `billable_events` parts written before it: starts
 * `MATERIALIZE TTL` until ClickHouse confirms one, then waits on it so its progress and failure
 * reach the upgrade ledger. Spec: modules/entitlement/specs/billable-events-retention-step.feature.
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
    let progress: TtlProgress = {
      mutationId: resumed?.mutationId ?? null,
      partsToDo: 0,
      started: resumed?.started ?? false,
      confirmed: resumed?.confirmed ?? false,
    };
    while (!signal.aborted) {
      const [latest] = await this.mutations.findTtlMutations();
      if (!latest) {
        // Listed while it runs: none after a confirmed start means ClickHouse finished it.
        if (dryRun || progress.confirmed) return { ...progress, partsToDo: 0 };
        // Not confirmed: never started, or a run stopped around the start. MATERIALIZE TTL is
        // idempotent, so issuing it again is safe where skipping it would leave the TTL unapplied.
        progress = { ...progress, partsToDo: 0, started: true };
        await onPoll(progress);
        await this.mutations.materialiseTtl();
        progress = { ...progress, confirmed: true };
        await onPoll(progress);
        continue;
      }
      progress = {
        mutationId: latest.mutationId,
        partsToDo: latest.partsToDo,
        started: progress.started,
        confirmed: progress.confirmed || !dryRun,
      };
      if (latest.isDone) return progress;
      if (latest.latestFailReason) throw new BillableEventsTtlFailedError(latest);
      if (dryRun) return progress;
      await onPoll(progress);
      await wait(this.pollIntervalMs, undefined, { signal }).catch(() => undefined);
    }
    return progress;
  }
}

/** ClickHouse listed the materialisation with a failure reason; the operator fixes and retries. */
export class BillableEventsTtlFailedError extends Error {
  readonly code = "billable_events_ttl_failed";

  constructor(mutation: TtlMutation) {
    super(
      `ClickHouse could not apply the billable_events retention TTL (mutation ${mutation.mutationId}, ` +
        `${mutation.partsToDo} parts left): ${mutation.latestFailReason}. ` +
        "Fix the cause on the ClickHouse server, then retry this step.",
    );
    this.name = "BillableEventsTtlFailedError";
  }
}
