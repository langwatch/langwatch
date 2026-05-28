import type { EventSourcedQueueProcessor } from "../queues/queue.types";
import { createLogger } from "../../../utils/logger/server";
import { captureException } from "../../../utils/posthogErrorCapture";
import { tenantIdFromGroupId } from "../../observability/tenantRateTracker";
import { isDispatchError } from "./dispatchError";
import type { OutboxService } from "./outbox.service";
import type { OutboxRow } from "./outbox.types";
import type { OutboxWakeup } from "./wakeupQueue";

const logger = createLogger("langwatch:event-sourcing:outbox-drainer");

/**
 * Dispatcher registered for a specific reactorName. Called once per
 * leased row; responsible for executing the actual side effect (HTTP
 * call, mailer, dataset write). Must raise `DispatchError` to signal
 * retryable / non-retryable failures — any other throw is treated as
 * retryable, see ADR-027.
 */
export type OutboxDispatcher = (row: OutboxRow) => Promise<void>;

export interface OutboxDrainerOptions {
  /**
   * How long the lease holds before another worker can re-claim. Set
   * higher than the slowest dispatcher's p99 to avoid double-dispatch
   * under healthy load.
   */
  leaseDurationMs?: number;
  /**
   * Soft cap on rows dispatched per wakeup. Prevents one busy group
   * from monopolising the worker — when the cap is reached, the
   * drainer schedules a follow-up wakeup and yields.
   */
  maxRowsPerWakeup?: number;
  /**
   * Called when a dispatched row needs a follow-up wakeup (drain cap
   * hit, retryable failure scheduled, etc). Typically delegates to
   * `wakeupQueue.send(...)`. Implementations should respect
   * `delay` for backoff.
   */
  scheduleWakeup: (params: {
    wakeup: OutboxWakeup;
    delayMs?: number;
  }) => Promise<void>;
}

const DEFAULT_LEASE_DURATION_MS = 60_000;
const DEFAULT_MAX_ROWS_PER_WAKEUP = 50;

/**
 * Glues a registry of per-reactor dispatchers onto the OutboxService.
 *
 * Phase 0 ships the scaffolding without any registered dispatchers —
 * Phase 1 attaches the alert-dispatch reactor and friends. Until then
 * the drainer is a no-op for unknown reactor names; it logs at debug
 * but does not error.
 */
export class OutboxDrainer {
  private readonly dispatchers = new Map<string, OutboxDispatcher>();
  private readonly leaseDurationMs: number;
  private readonly maxRowsPerWakeup: number;
  private readonly scheduleWakeup: OutboxDrainerOptions["scheduleWakeup"];

  constructor(
    private readonly outboxService: OutboxService,
    options: OutboxDrainerOptions,
  ) {
    this.leaseDurationMs =
      options.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS;
    this.maxRowsPerWakeup =
      options.maxRowsPerWakeup ?? DEFAULT_MAX_ROWS_PER_WAKEUP;
    this.scheduleWakeup = options.scheduleWakeup;
  }

  registerDispatcher(reactorName: string, dispatcher: OutboxDispatcher): void {
    if (this.dispatchers.has(reactorName)) {
      throw new Error(
        `OutboxDrainer: dispatcher for "${reactorName}" already registered`,
      );
    }
    this.dispatchers.set(reactorName, dispatcher);
  }

  /**
   * Handle a wakeup payload. Leases rows for (projectId, reactorName)
   * up to `maxRowsPerWakeup` and dispatches them through the
   * registered dispatcher. Yields when the cap is hit by scheduling
   * a follow-up wakeup.
   *
   * `projectId` is derived from `wakeup.groupKey` via
   * `tenantIdFromGroupId` — the producer is contracted to format
   * groupKey as `${projectId}/...`. See ADR-023.
   */
  async handleWakeup(wakeup: OutboxWakeup): Promise<void> {
    const dispatcher = this.dispatchers.get(wakeup.reactorName);
    if (!dispatcher) {
      logger.debug(
        { reactorName: wakeup.reactorName, groupKey: wakeup.groupKey },
        "Wakeup for unregistered reactor — dropped",
      );
      return;
    }

    const projectId = tenantIdFromGroupId(wakeup.groupKey);
    if (!projectId) {
      logger.error(
        { reactorName: wakeup.reactorName, groupKey: wakeup.groupKey },
        "Wakeup groupKey missing `${projectId}/` prefix — dropping (see ADR-023)",
      );
      return;
    }

    let dispatched = 0;
    while (dispatched < this.maxRowsPerWakeup) {
      const row = await this.outboxService.leaseNext({
        projectId,
        reactorName: wakeup.reactorName,
        leaseDurationMs: this.leaseDurationMs,
      });
      if (!row) return;

      await this.dispatchOne({ row, dispatcher });
      dispatched += 1;
    }

    // Drain cap hit: yield with an immediate follow-up wakeup so
    // other groups get a turn but this one keeps draining.
    await this.scheduleWakeup({ wakeup });
  }

  private async dispatchOne({
    row,
    dispatcher,
  }: {
    row: OutboxRow;
    dispatcher: OutboxDispatcher;
  }): Promise<void> {
    try {
      await dispatcher(row);
      await this.outboxService.markDispatched(row.id);
      return;
    } catch (error) {
      const isRetryable = !isDispatchError(error) || error.retryable;
      const message =
        error instanceof Error ? error.message : String(error);

      if (!isRetryable) {
        await this.outboxService.markDead({ rowId: row.id, error: message });
        logger.warn(
          {
            rowId: row.id,
            reactorName: row.reactorName,
            projectId: row.projectId,
            error: message,
          },
          "Outbox dispatch failed permanently",
        );
        captureException(error, {
          extra: {
            outboxRowId: row.id,
            reactorName: row.reactorName,
            projectId: row.projectId,
          },
        });
        return;
      }

      const result = await this.outboxService.markFailedRetryable({
        rowId: row.id,
        error: message,
      });

      if (result.status === "dead") {
        logger.warn(
          {
            rowId: row.id,
            reactorName: row.reactorName,
            projectId: row.projectId,
            attempts: row.attempts,
            error: message,
          },
          "Outbox dispatch exhausted retries",
        );
        captureException(error, {
          extra: {
            outboxRowId: row.id,
            reactorName: row.reactorName,
            projectId: row.projectId,
            attempts: row.attempts,
          },
        });
        return;
      }

      if (result.nextAttemptAt) {
        const delayMs = Math.max(
          0,
          result.nextAttemptAt.getTime() - Date.now(),
        );
        await this.scheduleWakeup({
          wakeup: {
            reactorName: row.reactorName,
            groupKey: row.groupKey,
            scheduledAt: result.nextAttemptAt.getTime(),
          },
          delayMs,
        });
      }
    }
  }
}

/**
 * Helper to build a `scheduleWakeup` callback backed by a GroupQueue
 * processor. Used by `OutboxDrainer` constructor wiring at app boot.
 */
export function makeScheduleWakeupFromQueue(
  queue: EventSourcedQueueProcessor<OutboxWakeup>,
): OutboxDrainerOptions["scheduleWakeup"] {
  return async ({ wakeup, delayMs }) => {
    await queue.send(wakeup, delayMs ? { delay: delayMs } : undefined);
  };
}
