import type { Logger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";
import type fastq from "fastq";

import { gqJobsDispatchedTotal } from "./metrics.ts";
import type { DispatchResult, GroupStagingScripts } from "./scripts.ts";

/** Max jobs to dispatch per Lua call to bound script execution time. */
const MAX_BATCH_SIZE = 200;

/** The dedicated connection the dispatcher blocks on; an IORedis or a Cluster. */
interface BlockingConnection {
  brpop(key: string, timeout: number): Promise<unknown>;
  del(key: string): Promise<number>;
}

/**
 * Dispatcher loop: waits for signals on the Redis signal list and dispatches
 * jobs from the staging layer into the fastq processing queue.
 */
export class GroupQueueDispatcher {
  private shutdownRequested = false;
  private running = false;
  private paused = false;
  /** Ends the loop's wait: for a resume, or a listed-group dispatcher's poll. */
  private wake: (() => void) | null = null;
  /** A listed-group dispatcher's own job finished since its last claim: it claims again at once. */
  private slotFreed = false;
  /** The open list that claims first next time, so each list leads in turn. */
  private nextList = 0;
  /** The candidates the last listed claim scanned; the poll wakes when the soonest comes due. */
  private scannedCandidates: readonly string[] = [];
  /** The clock just before the last claim: a candidate due since then may have been missed. */
  private claimedAtMs = 0;

  constructor(
    private readonly params: {
      scripts: Pick<
        GroupStagingScripts,
        "getSignalKey" | "getEarliestReadyScore" | "getEarliestCandidateScore" | "dispatchBatch"
      >;
      processingQueue: fastq.queueAsPromised<DispatchResult, void>;
      blockingConnection: BlockingConnection;
      queueName: string;
      globalConcurrency: number;
      activeTtlSec: number;
      signalTimeoutSec: number;
      logger: Logger;
      dispatchGroupAllowListKey?: string;
      /** The lists a listed-group dispatcher runs, read before each claim. */
      listedGroupsKeys?: () => Promise<readonly string[]>;
    },
  ) {}

  /** Runs only listed groups, beside the queue's own dispatcher. */
  private get listed(): boolean {
    return (
      this.params.dispatchGroupAllowListKey !== undefined ||
      this.params.listedGroupsKeys !== undefined
    );
  }

  private async handleLoopError(error: unknown): Promise<void> {
    if (this.shutdownRequested) return;

    const errorMessage = error instanceof Error ? error.message : String(error);

    if (errorMessage.includes("Connection is closed")) {
      this.params.logger.debug(
        { queueName: this.params.queueName },
        "Redis connection closed, stopping dispatcher",
      );
      this.shutdownRequested = true;
      return;
    }

    this.params.logger.error(
      {
        queueName: this.params.queueName,
        error: errorMessage,
      },
      "Dispatcher loop error",
    );

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  start(): void {
    this.running = true;
    void this.run();
  }

  private async run(): Promise<void> {
    // A resume dispatches at once: signals that arrived while paused were drained unclaimed.
    let dispatchNow = false;
    while (!this.shutdownRequested) {
      try {
        if (this.paused) {
          await this.untilWoken();
          dispatchNow = true;
          continue;
        }
        if (!dispatchNow) await this.waitForSignal();
        dispatchNow = false;
        await this.dispatchUntilEmpty();
      } catch (error) {
        await this.handleLoopError(error);
      }
    }

    this.running = false;
    this.params.logger.debug({ queueName: this.params.queueName }, "Dispatcher loop stopped");
  }

  private async dispatchUntilEmpty(): Promise<void> {
    let dispatched: number;
    do {
      dispatched = await this.dispatchBatch();
      if (dispatched > 0) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    } while (dispatched > 0 && !this.shutdownRequested);

    // Drain signals that arrived during dispatch to prevent
    // immediate re-wake from stale notifications
    if (this.listed) return;
    const signalKey = this.params.scripts.getSignalKey();
    await this.params.blockingConnection.del(signalKey);
  }

  requestShutdown(): void {
    this.shutdownRequested = true;
    this.wake?.();
  }

  /** Claims no further batch; a claim already issued still hands its jobs over. Idempotent. */
  pause(): void {
    if (this.paused) return;
    this.paused = true;
    this.params.logger.info({ queueName: this.params.queueName }, "Dispatcher paused");
  }

  /** Claims again from where the pause stopped. Idempotent. */
  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.params.logger.info({ queueName: this.params.queueName }, "Dispatcher resumed");
    this.wake?.();
  }

  private wakeForFreedSlot(): void {
    this.slotFreed = true;
    if (!this.paused) this.wake?.();
  }

  private untilWoken(): Promise<void> {
    return new Promise((resolve) => {
      this.wake = () => {
        this.wake = null;
        resolve();
      };
    });
  }

  async waitUntilStopped(): Promise<void> {
    while (this.running) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  private async waitForSignal(): Promise<void> {
    if (this.listed) return this.pollListedGroups();
    const signalKey = this.params.scripts.getSignalKey();
    await this.params.blockingConnection.brpop(signalKey, await this.nextWakeTimeoutSec());
    // Drain remaining buffered signals — the upcoming dispatchBatch
    // handles multiple jobs in one Lua call, so N signals = 1 cycle.
    await this.params.blockingConnection.del(signalKey);
  }

  /**
   * A listed-group dispatcher beside the queue's own polls instead: the signal list
   * is the whole queue's, and taking from it leaves the other dispatcher asleep.
   */
  private async pollListedGroups(): Promise<void> {
    const dueAtMs = await this.nextListedPollAtMs();
    if (this.slotFreed || this.shutdownRequested || this.paused) return;
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      // The claim scans candidates strictly below its clock, and a timer can fire on the due
      // millisecond itself: re-arm until it has passed, or the candidate waits out the idle poll.
      const arm = () => {
        const nowMs = nowInstant().epochMilliseconds;
        if (nowMs > dueAtMs) this.wake?.();
        else timer = setTimeout(arm, dueAtMs - nowMs + 1);
      };
      this.wake = () => {
        clearTimeout(timer);
        this.wake = null;
        resolve();
      };
      arm();
    });
  }

  /** A group passed over while running, or due soon, is claimed just after its candidate score. */
  private async nextListedPollAtMs(): Promise<number> {
    const nowMs = nowInstant().epochMilliseconds;
    const idleAtMs = nowMs + this.params.signalTimeoutSec * 1000;
    if (this.saturated() || this.scannedCandidates.length === 0) return idleAtMs;
    try {
      const earliest = await this.params.scripts.getEarliestCandidateScore({
        candidatesKeys: this.scannedCandidates,
        afterMs: this.claimedAtMs - 1,
      });
      if (earliest === null) return idleAtMs;
      return Math.min(idleAtMs, Math.max(earliest, nowMs + 50));
    } catch {
      // Peek is best-effort; fall back to the fixed interval.
      return idleAtMs;
    }
  }

  private saturated(): boolean {
    return (
      this.params.processingQueue.length() + this.params.processingQueue.running() >=
      this.params.globalConcurrency
    );
  }

  /**
   * Clamps BRPOP timeout to the earliest due group, handling delayed jobs
   * and signal-loss edge cases; falls back to fixed interval when saturated.
   */
  private async nextWakeTimeoutSec(): Promise<number> {
    if (this.saturated()) return this.params.signalTimeoutSec;
    try {
      const earliest = await this.params.scripts.getEarliestReadyScore();
      if (earliest === null) return this.params.signalTimeoutSec;
      const untilDueSec = (earliest - nowInstant().epochMilliseconds) / 1000;
      return Math.min(this.params.signalTimeoutSec, Math.max(untilDueSec, 0.05));
    } catch {
      // Peek is best-effort; fall back to the fixed interval.
      return this.params.signalTimeoutSec;
    }
  }

  /** One claim over the allow-list, or over each open list in turn while slots remain. */
  private async claim(maxJobs: number): Promise<DispatchResult[]> {
    this.claimedAtMs = nowInstant().epochMilliseconds;
    const claimFrom = ({
      allowedGroupsKey,
      jobs,
      listKey,
    }: {
      allowedGroupsKey: string | undefined;
      jobs: number;
      listKey?: string;
    }) =>
      this.params.scripts.dispatchBatch({
        nowMs: nowInstant().epochMilliseconds,
        activeTtlSec: this.params.activeTtlSec,
        maxJobs: jobs,
        allowedGroupsKey,
        ...(listKey ? { listKey } : {}),
      });
    if (!this.params.listedGroupsKeys) {
      const allowList = this.params.dispatchGroupAllowListKey;
      this.scannedCandidates = allowList ? [allowList] : [];
      return claimFrom({ allowedGroupsKey: allowList, jobs: maxJobs });
    }
    const results: DispatchResult[] = [];
    const lists = await this.params.listedGroupsKeys();
    this.scannedCandidates = lists.map((listKey) => `${listKey}:candidates`);
    const first = this.nextList++ % Math.max(lists.length, 1);
    for (const listKey of [...lists.slice(first), ...lists.slice(0, first)]) {
      if (results.length >= maxJobs) break;
      const jobs = maxJobs - results.length;
      results.push(
        ...(await claimFrom({ allowedGroupsKey: `${listKey}:candidates`, jobs, listKey })),
      );
    }
    return results;
  }

  private async dispatchBatch(): Promise<number> {
    if (this.paused) return 0;
    this.slotFreed = false;
    const availableSlots =
      this.params.globalConcurrency -
      this.params.processingQueue.length() -
      this.params.processingQueue.running();
    if (availableSlots <= 0) {
      return 0;
    }

    const maxJobs = Math.min(availableSlots, MAX_BATCH_SIZE);
    const results = await this.claim(maxJobs);

    for (const result of results) {
      const run = this.params.processingQueue.push(result).catch((err) => {
        this.params.logger.debug(
          {
            queueName: this.params.queueName,
            groupId: result.groupId,
            stagedJobId: result.stagedJobId,
            error: err instanceof Error ? err.message : String(err),
          },
          "fastq push error (already handled in processWithRetries)",
        );
      });
      // The shared signal is the main dispatcher's; a listed one wakes on its own freed slot.
      if (this.listed) void run.finally(() => this.wakeForFreedSlot());

      gqJobsDispatchedTotal.inc({ queue_name: this.params.queueName });
    }

    if (results.length > 0) {
      this.params.logger.debug(
        {
          queueName: this.params.queueName,
          count: results.length,
        },
        "Batch dispatched jobs from staging to fastq",
      );
    }

    return results.length;
  }
}
