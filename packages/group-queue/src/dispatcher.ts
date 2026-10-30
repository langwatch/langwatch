import type { Logger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";
import type fastq from "fastq";

import { gqJobsDispatchedTotal } from "./metrics.ts";
import type { DispatchedWork, DispatchResult, GroupStagingScripts } from "./scripts.ts";

/** Max jobs to dispatch per Lua call to bound script execution time. */
const MAX_BATCH_SIZE = 200;
/** Claims at or above this many leave no pause before the next: there is a backlog to drain. */
const FULL_CLAIM = 32;

/** The shortest BRPOP wait: a due-but-unclaimable group cannot spin the loop faster. */
const MIN_SIGNAL_WAIT_MS = 50;

/**
 * One script reply's claims: those sharing a batch slot become one cross-group task, the rest run
 * alone, in claim order. Slots are numbered per call, so never pass claims of two calls together.
 */
export function dispatchedWorkOf(results: readonly DispatchResult[]): DispatchedWork[] {
  const work: DispatchedWork[] = [];
  const batches = new Map<number, DispatchResult[]>();
  for (const result of results) {
    const slot = result.batchSlot;
    if (slot === undefined || !Number.isSafeInteger(slot)) {
      work.push(result);
      continue;
    }
    const batch = batches.get(slot);
    if (batch) {
      batch.push(result);
      continue;
    }
    const groups = [result];
    batches.set(slot, groups);
    work.push({ groups });
  }
  return work.map((each) =>
    "groups" in each && each.groups.length === 1 ? each.groups[0]! : each,
  );
}

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
  /** Each candidates set the last listed claim scanned, and the clock it scanned below. */
  private scannedCandidates: readonly { key: string; scannedToMs: number }[] = [];
  /** The clock just before the last claim: a candidate due since then may have been missed. */
  private claimedAtMs = 0;
  /** The last claim's clock, and when the groups it passed over come due to this worker (#9148). */
  private passOver: { scannedToMs: number; untilMs: number } | null = null;

  constructor(
    private readonly params: {
      scripts: Pick<
        GroupStagingScripts,
        "getSignalKey" | "getEarliestReadyScore" | "getEarliestCandidateScore" | "claimBatch"
      >;
      processingQueue: fastq.queueAsPromised<DispatchedWork, void>;
      blockingConnection: BlockingConnection;
      queueName: string;
      /** Slots this consumer runs; a function when the count adapts at runtime. */
      globalConcurrency: number | (() => number);
      activeTtlSec: number;
      signalTimeoutSec: number;
      /** Staging's settling window; above 0, a group due within one BRPOP wait is met on time. */
      settleWindowMs?: number;
      logger: Logger;
      dispatchGroupAllowListKey?: string;
      /** The lists a listed-group dispatcher runs, read before each claim. */
      listedGroupsKeys?: () => Promise<readonly string[]>;
      /** Cross-group batching, read before each claim; absent or one group claims each alone. */
      groupBatch?: () => { maxGroups: number; routes: readonly string[] } | undefined;
      /** The worker stamped on each claim's poison-guard marker, read before each claim. */
      claimGuardWorkerId?: () => string | undefined;
      /** This worker: the claim passes over a group whose job it handed back. */
      workerId?: string;
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
      // A short claim means the queue is nearly drained: pause so arrivals gather. A full one
      // means a backlog, so only yield the turn; a fixed pause capped each pod's claim rate.
      if (dispatched > 0 && dispatched < FULL_CLAIM) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      } else if (dispatched > 0) {
        await new Promise((resolve) => setImmediate(resolve));
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
    const untilDueMs = await this.untilEarliestDueMs();
    // A settling group comes due within one BRPOP floor; signals meanwhile stay listed.
    if (this.settlesBeforeFloor(untilDueMs)) {
      await new Promise((resolve) => setTimeout(resolve, untilDueMs + 1));
      return;
    }
    // Buffered signals stay until the cycle ends: dispatchUntilEmpty clears them in its one DEL,
    // which drops nothing a DEL here would have kept, so N signals still cost one cycle.
    await this.params.blockingConnection.brpop(signalKey, this.wakeTimeoutSec(untilDueMs));
  }

  private settlesBeforeFloor(untilDueMs: number | null): untilDueMs is number {
    return (
      (this.params.settleWindowMs ?? 0) > 0 &&
      untilDueMs !== null &&
      untilDueMs > 0 &&
      untilDueMs < MIN_SIGNAL_WAIT_MS
    );
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
      const passOverUntilMs =
        this.passOver && this.passOver.untilMs > nowMs ? this.passOver.untilMs : null;
      // A passed-over group keeps its shared candidate score for a peer: past each list's own
      // claim only, so the poll wakes as the pass-over lapses rather than re-scanning it.
      const scores = await Promise.all(
        this.scannedCandidates.map(({ key, scannedToMs }) =>
          this.params.scripts.getEarliestCandidateScore({
            candidatesKeys: [key],
            afterMs: passOverUntilMs === null ? this.claimedAtMs - 1 : scannedToMs,
          }),
        ),
      );
      const due = [...scores, passOverUntilMs].filter((score) => score !== null);
      if (due.length === 0) return idleAtMs;
      return Math.min(idleAtMs, Math.max(Math.min(...due), nowMs + 50));
    } catch {
      // Peek is best-effort; fall back to the fixed interval.
      return idleAtMs;
    }
  }

  private slots(): number {
    const { globalConcurrency } = this.params;
    return typeof globalConcurrency === "number" ? globalConcurrency : globalConcurrency();
  }

  private saturated(): boolean {
    return (
      this.params.processingQueue.length() + this.params.processingQueue.running() >= this.slots()
    );
  }

  /** Milliseconds until the earliest ready group is due; null when saturated, empty or unknown. */
  private async untilEarliestDueMs(): Promise<number | null> {
    if (this.saturated()) return null;
    try {
      const passOver = this.passOver;
      if (passOver && passOver.untilMs > nowInstant().epochMilliseconds) {
        // A passed-over group waits for a peer: wake as it lapses, or for one due after the claim.
        const next = await this.params.scripts.getEarliestReadyScore({
          afterMs: passOver.scannedToMs,
        });
        return (
          Math.min(passOver.untilMs, next ?? passOver.untilMs) - nowInstant().epochMilliseconds
        );
      }
      const earliest = await this.params.scripts.getEarliestReadyScore();
      if (earliest === null) return null;
      return earliest - nowInstant().epochMilliseconds;
    } catch {
      // Peek is best-effort; fall back to the fixed interval.
      return null;
    }
  }

  /**
   * Clamps BRPOP timeout to the earliest due group, handling delayed jobs
   * and signal-loss edge cases; falls back to fixed interval when saturated.
   */
  private wakeTimeoutSec(untilDueMs: number | null): number {
    if (untilDueMs === null) return this.params.signalTimeoutSec;
    return Math.min(this.params.signalTimeoutSec, Math.max(untilDueMs, MIN_SIGNAL_WAIT_MS) / 1000);
  }

  /** One claim over the allow-list, or over each open list in turn while slots remain. */
  private async claim(maxJobs: number): Promise<DispatchedWork[]> {
    this.claimedAtMs = nowInstant().epochMilliseconds;
    this.passOver = null;
    if (!this.params.listedGroupsKeys) return this.claimUnlisted(maxJobs);
    const work: DispatchedWork[] = [];
    const lists = await this.params.listedGroupsKeys();
    this.scannedCandidates = this.scannedBeforeClaim(
      lists.map((listKey) => `${listKey}:candidates`),
    );
    const first = this.nextList++ % Math.max(lists.length, 1);
    for (const listKey of [...lists.slice(first), ...lists.slice(0, first)]) {
      if (work.length >= maxJobs) break;
      const jobs = maxJobs - work.length;
      // Each list's reply numbers its batch slots from one, so it is grouped on its own.
      const claims = await this.claimCandidates({
        allowedGroupsKey: `${listKey}:candidates`,
        jobs,
        listKey,
      });
      work.push(...dispatchedWorkOf(claims));
    }
    return work;
  }

  /** The queue's own claim, or one over its allow-list. */
  private async claimUnlisted(maxJobs: number): Promise<DispatchedWork[]> {
    const allowList = this.params.dispatchGroupAllowListKey;
    this.scannedCandidates = this.scannedBeforeClaim(allowList ? [allowList] : []);
    if (allowList) {
      return dispatchedWorkOf(
        await this.claimCandidates({ allowedGroupsKey: allowList, jobs: maxJobs }),
      );
    }
    const nowMs = nowInstant().epochMilliseconds;
    const { claims, passedOverUntilMs } = await this.params.scripts.claimBatch({
      nowMs,
      activeTtlSec: this.params.activeTtlSec,
      maxJobs,
      ...this.groupBatchArgs(),
      ...this.claimer(),
    });
    this.passOver =
      passedOverUntilMs === null ? null : { scannedToMs: nowMs, untilMs: passedOverUntilMs };
    return dispatchedWorkOf(claims);
  }

  /** One candidates set's claim; it records the clock it scanned below and any pass-over. */
  private async claimCandidates({
    allowedGroupsKey,
    jobs,
    listKey,
  }: {
    allowedGroupsKey: string;
    jobs: number;
    listKey?: string;
  }): Promise<DispatchResult[]> {
    const nowMs = nowInstant().epochMilliseconds;
    const { claims, passedOverUntilMs } = await this.params.scripts.claimBatch({
      nowMs,
      activeTtlSec: this.params.activeTtlSec,
      maxJobs: jobs,
      allowedGroupsKey,
      ...(listKey ? { listKey } : {}),
      ...this.claimer(),
    });
    const scannedList = this.scannedCandidates.find(({ key }) => key === allowedGroupsKey);
    if (scannedList) scannedList.scannedToMs = nowMs;
    if (passedOverUntilMs !== null) {
      const untilMs = Math.min(passedOverUntilMs, this.passOver?.untilMs ?? passedOverUntilMs);
      this.passOver = { scannedToMs: nowMs, untilMs };
    }
    return claims;
  }

  /** A list left unclaimed this time is peeked from just before the claim, as before it. */
  private scannedBeforeClaim(keys: readonly string[]): { key: string; scannedToMs: number }[] {
    return keys.map((key) => ({ key, scannedToMs: this.claimedAtMs - 1 }));
  }

  /** Who claims: the poison-guard marker's worker, read before each claim, and this worker. */
  private claimer(): { claimGuardWorkerId?: string; workerId?: string } {
    const claimGuardWorkerId = this.params.claimGuardWorkerId?.();
    const { workerId } = this.params;
    return {
      ...(claimGuardWorkerId ? { claimGuardWorkerId } : {}),
      ...(workerId ? { workerId } : {}),
    };
  }

  /** Batching for the queue's own claim; listed and allow-listed claims take groups alone. */
  private groupBatchArgs(): {
    groupBatch?: { maxGroups: number; routes: readonly string[]; maxClaims: number };
  } {
    const batching = this.params.groupBatch?.();
    if (!batching || batching.maxGroups <= 1 || batching.routes.length === 0) return {};
    return { groupBatch: { ...batching, maxClaims: MAX_BATCH_SIZE } };
  }

  private async dispatchBatch(): Promise<number> {
    if (this.paused) return 0;
    this.slotFreed = false;
    const availableSlots =
      this.slots() - this.params.processingQueue.length() - this.params.processingQueue.running();
    if (availableSlots <= 0) {
      return 0;
    }

    const maxJobs = Math.min(availableSlots, MAX_BATCH_SIZE);
    let claimed = 0;

    for (const work of await this.claim(maxJobs)) {
      const claims = "groups" in work ? work.groups : [work];
      claimed += claims.length;
      const run = this.params.processingQueue.push(work).catch((err) => {
        this.params.logger.debug(
          {
            queueName: this.params.queueName,
            groupIds: claims.map((claim) => claim.groupId),
            stagedJobIds: claims.map((claim) => claim.stagedJobId),
            error: err instanceof Error ? err.message : String(err),
          },
          "fastq push error (already handled in processWithRetries)",
        );
      });
      // The shared signal is the main dispatcher's; a listed one wakes on its own freed slot.
      if (this.listed) void run.finally(() => this.wakeForFreedSlot());

      gqJobsDispatchedTotal.inc({ queue_name: this.params.queueName }, claims.length);
    }

    if (claimed > 0) {
      this.params.logger.debug(
        {
          queueName: this.params.queueName,
          count: claimed,
        },
        "Batch dispatched jobs from staging to fastq",
      );
    }

    return claimed;
  }
}
