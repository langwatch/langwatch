import { setTimeout as wait } from "node:timers/promises";

import type {
  ClickHouseTarget,
  KeepForeverRewrite,
  RetroactiveRetentionRepository,
} from "../repositories/retroactive-retention.repository.ts";

const POLL_INTERVAL_MS = 30_000;
const SHARED_TARGET = "shared";

/** What the step saves after each target and returns at the end; dry runs list `wouldStart`. */
export type KeepForeverProgress = Readonly<{
  done: readonly string[];
  wouldStart: readonly string[];
}>;

/**
 * Re-stamps the event log rows written before only customer telemetry expired (Alex,
 * 2026-10-09), one rewrite per ClickHouse target through eventing's retention operation.
 * Spec: modules/data-retention/specs/event-log-retention-via-eventing.feature.
 */
export class EventLogKeepForeverService {
  private constructor(
    private readonly retroactive: RetroactiveRetentionRepository,
    private readonly pollIntervalMs: number,
  ) {}

  static create({
    retroactive,
    pollIntervalMs = POLL_INTERVAL_MS,
  }: {
    retroactive: RetroactiveRetentionRepository;
    pollIntervalMs?: number;
  }): EventLogKeepForeverService {
    return new EventLogKeepForeverService(retroactive, pollIntervalMs);
  }

  async keepIndefiniteEventsForever({
    dryRun,
    signal,
    done: alreadyDone,
    onTargetDone,
  }: {
    dryRun: boolean;
    signal: AbortSignal;
    done: readonly string[];
    onTargetDone: (progress: KeepForeverProgress) => Promise<void>;
  }): Promise<KeepForeverProgress> {
    const done = [...alreadyDone];
    const wouldStart: string[] = [];
    for (const target of this.retroactive.keepForeverTargets()) {
      const name = target.organizationId ?? SHARED_TARGET;
      if (done.includes(name)) continue;
      if (signal.aborted) break;
      const [latest] = await this.retroactive.findKeepForeverRewrites(target);
      const running = latest !== undefined && !latest.isDone;
      if (dryRun) {
        if (!running) wouldStart.push(name);
        continue;
      }
      if (!running) await this.retroactive.startKeepForeverRewrite(target);
      if (!(await this.finished({ target, signal }))) break;
      done.push(name);
      await onTargetDone({ done, wouldStart });
    }
    return { done, wouldStart };
  }

  /** Polls the target's newest rewrite until it is done; false when aborted first. */
  private async finished({
    target,
    signal,
  }: {
    target: ClickHouseTarget;
    signal: AbortSignal;
  }): Promise<boolean> {
    while (!signal.aborted) {
      const [latest] = await this.retroactive.findKeepForeverRewrites(target);
      if (latest === undefined || latest.isDone) return true;
      if (latest.latestFailReason) throw failedRewrite({ target, rewrite: latest });
      await wait(this.pollIntervalMs, undefined, { signal }).catch(() => undefined);
    }
    return false;
  }
}

function failedRewrite({
  target,
  rewrite,
}: {
  target: ClickHouseTarget;
  rewrite: KeepForeverRewrite;
}): Error {
  return new Error(
    `ClickHouse could not re-stamp the event log's never-expiring rows on the ` +
      `${target.organizationId ?? SHARED_TARGET} target (mutation ${rewrite.mutationId}, ` +
      `${rewrite.partsToDo} parts left): ${rewrite.latestFailReason}. ` +
      "Fix the cause on the ClickHouse server, then retry this step.",
  );
}
