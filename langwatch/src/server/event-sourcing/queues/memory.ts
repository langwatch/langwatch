import { createLogger } from "@langwatch/observability";
import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import type { SemConvAttributes } from "langwatch/observability";
import type {
  DeduplicationConfig,
  EventSourcedQueueDefinition,
  EventSourcedQueueProcessor,
  QueueSendOptions,
} from "../queues";

interface QueuedJob<Payload> {
  payload: Payload;
  jobId: string;
  deduplicationId?: string;
  /**
   * Wall-clock time this job becomes eligible to run. A delayed job WAITS IN
   * THE QUEUE rather than in a worker slot, so it stays visible to the dedup
   * map for its whole window and cannot squat on the concurrency limit.
   */
  dispatchAt: number;
  /** Wall-clock time the dedup id stops absorbing new sends. */
  dedupExpiresAt?: number;
  shouldSurviveDispatch?: boolean;
  resolve: () => void;
  reject: (error: Error) => void;
}

/**
 * Minimal in-memory queue processor for dev/test environments.
 * Processes jobs asynchronously with simple concurrency control.
 *
 * **Use Cases:**
 * - Local development (when Redis is not available)
 * - Unit/integration tests
 * - Single-instance deployments
 *
 * **Limitations:**
 * - Not thread-safe (single process only)
 * - No persistence (jobs lost on restart)
 * - Simple concurrency (no advanced scheduling)
 */
export class EventSourcedQueueProcessorMemory<
  Payload extends Record<string, unknown>,
> implements EventSourcedQueueProcessor<Payload>
{
  private readonly logger = createLogger("langwatch:event-sourcing:queue");
  private readonly tracer: ReturnType<typeof getLangWatchTracer>;
  private readonly queueName: string;
  private readonly process: (payload: Payload) => Promise<void>;
  private readonly spanAttributes?: (payload: Payload) => SemConvAttributes;
  private readonly deduplication?: DeduplicationConfig<Payload>;
  private readonly delay?: number;
  private readonly concurrency: number;

  // Simple queue state
  private readonly queue: QueuedJob<Payload>[] = [];
  /** Map of deduplication ID to job for deduplication */
  private readonly pendingJobsByDeduplicationId = new Map<
    string,
    QueuedJob<Payload>
  >();
  /**
   * Dedup ids whose job already dispatched but whose TTL is still running,
   * for senders that asked to survive dispatch. Mirrors the GroupQueue Lua's
   * opt-in branch: without it a dispatched key is stale and restages.
   */
  private readonly suppressedUntilByDeduplicationId = new Map<string, number>();
  private activeCount = 0;
  private dispatchTimer: ReturnType<typeof setTimeout> | null = null;
  private dispatchTimerAt = Number.POSITIVE_INFINITY;

  constructor(definition: EventSourcedQueueDefinition<Payload>) {
    const { name, process, spanAttributes, deduplication, delay, options } =
      definition;

    this.tracer = getLangWatchTracer("langwatch.event-sourcing.queue");
    this.spanAttributes = spanAttributes;
    this.deduplication = deduplication;
    this.delay = delay;
    this.concurrency = options?.concurrency ?? 5;
    this.queueName = name;
    this.process = process;

    this.logger.debug(
      { queueName: this.queueName, concurrency: this.concurrency },
      "Event-sourced queue processor initialized in memory mode (no Redis)",
    );
  }

  /**
   * Generates a unique job ID for the payload.
   * Uses payload.id if available (for Event payloads), otherwise generates a random ID.
   * Format: ${queueName}:${payloadId}
   */
  private generateJobId(payload: Payload): string {
    const payloadWithId = payload as { id?: string };
    const payloadId = payloadWithId.id ?? crypto.randomUUID();
    return `${this.queueName}:${payloadId}`;
  }

  async send(
    payload: Payload,
    options?: QueueSendOptions<Payload>,
  ): Promise<void> {
    // Memory implementation allows sends after close since it has no persistent state
    // This is different from BullMQ which should reject sends after shutdown

    const dedup = options?.deduplication ?? this.deduplication;
    const effectiveDelay = options?.delay ?? this.delay;

    const jobId = this.generateJobId(payload);
    const deduplicationId = dedup?.makeId(payload);

    const now = Date.now();
    const dispatchAt = now + (effectiveDelay ?? 0);
    const dedupExpiresAt =
      dedup?.ttlMs === undefined ? undefined : now + dedup.ttlMs;

    // Simple job deduplication: squash onto existing job with same deduplication ID
    if (deduplicationId) {
      const suppressedUntil =
        this.suppressedUntilByDeduplicationId.get(deduplicationId);
      if (suppressedUntil !== undefined) {
        if (suppressedUntil > now) {
          this.logger.debug(
            { queueName: this.queueName, jobId, deduplicationId },
            "Discarded send: dedup id still suppressed after dispatch",
          );
          return;
        }
        this.suppressedUntilByDeduplicationId.delete(deduplicationId);
      }

      const existingJob =
        this.pendingJobsByDeduplicationId.get(deduplicationId);
      if (existingJob) {
        const expired =
          existingJob.dedupExpiresAt !== undefined &&
          existingJob.dedupExpiresAt <= now;
        if (expired) {
          // The window closed while the job waited. It still runs, but it
          // stops absorbing sends so this one stages as genuinely new.
          this.pendingJobsByDeduplicationId.delete(deduplicationId);
        } else {
          if (dedup?.replace !== false) {
            existingJob.payload = payload;
          }
          // `extend` moves the DEADLINE, matching GroupQueue. Left off, the
          // window stays pinned to the send that opened it, so a continuous
          // stream cannot defer its own job indefinitely.
          if (dedup?.extend !== false) {
            existingJob.dispatchAt = dispatchAt;
            existingJob.dedupExpiresAt = dedupExpiresAt;
          }
          this.logger.debug(
            { queueName: this.queueName, jobId, deduplicationId },
            "Squashed onto existing job with same deduplication ID",
          );
          return;
        }
      }
    }

    // Queue job and process asynchronously
    return new Promise<void>((resolve, reject) => {
      const job: QueuedJob<Payload> = {
        payload,
        jobId,
        deduplicationId,
        dispatchAt,
        dedupExpiresAt,
        shouldSurviveDispatch: dedup?.shouldSurviveDispatch === true,
        resolve,
        reject,
      };

      if (deduplicationId) {
        this.pendingJobsByDeduplicationId.set(deduplicationId, job);
      }

      this.queue.push(job);
      // Start processing if we have capacity
      this.tryProcessNext();
    });
  }

  async sendBatch(
    payloads: Payload[],
    options?: QueueSendOptions<Payload>,
  ): Promise<void> {
    await Promise.all(payloads.map((payload) => this.send(payload, options)));
  }

  /**
   * Processes next job from queue if capacity available.
   */
  private tryProcessNext(): void {
    // No capacity or no jobs
    // Memory implementation allows processing after shutdown since it has no persistent state
    if (this.activeCount >= this.concurrency || this.queue.length === 0) {
      return;
    }

    const now = Date.now();
    const { readyIndex, earliestPending } = this.findDueJob(now);

    if (readyIndex === -1) {
      this.scheduleWake(earliestPending - now);
      return;
    }

    const [job] = this.queue.splice(readyIndex, 1);
    if (!job) {
      return;
    }

    // Release the dedup entry only now, as the job actually leaves staging —
    // new sends with the same id should squash for the whole window and only
    // then create a genuinely new job (same TOCTOU fix as GroupQueue Lua).
    if (job.deduplicationId) {
      this.pendingJobsByDeduplicationId.delete(job.deduplicationId);
      if (job.shouldSurviveDispatch && job.dedupExpiresAt !== undefined) {
        this.suppressedUntilByDeduplicationId.set(
          job.deduplicationId,
          job.dedupExpiresAt,
        );
      }
    }

    this.activeCount++;
    void this.processJob(job).finally(() => {
      this.activeCount--;
      // Try to process next job
      this.tryProcessNext();
    });
  }

  /**
   * First job whose deadline has passed, keeping FIFO among the ready ones,
   * plus when the earliest not-yet-due job becomes eligible.
   *
   * A job that is not due yet stays in the queue: waiting inside a worker slot
   * would hold the slot for the whole delay and, on a queue shared by every
   * handler in memory mode, starve everything behind it.
   */
  private findDueJob(now: number): {
    readyIndex: number;
    earliestPending: number;
  } {
    let earliestPending = Number.POSITIVE_INFINITY;
    for (const [index, queued] of this.queue.entries()) {
      if (queued.dispatchAt <= now) {
        return { readyIndex: index, earliestPending };
      }
      earliestPending = Math.min(earliestPending, queued.dispatchAt);
    }
    return { readyIndex: -1, earliestPending };
  }

  /**
   * Wakes the scheduler when the earliest not-yet-due job becomes eligible.
   * Keeps at most one timer, moving it earlier when a nearer job arrives.
   */
  private scheduleWake(delayMs: number): void {
    const wakeAt = Date.now() + Math.max(0, delayMs);
    if (this.dispatchTimer !== null && this.dispatchTimerAt <= wakeAt) {
      return;
    }
    if (this.dispatchTimer !== null) {
      clearTimeout(this.dispatchTimer);
    }
    this.dispatchTimerAt = wakeAt;
    this.dispatchTimer = setTimeout(
      () => {
        this.dispatchTimer = null;
        this.dispatchTimerAt = Number.POSITIVE_INFINITY;
        this.tryProcessNext();
      },
      Math.max(0, delayMs),
    );
    // Never hold the process open just to fire a delayed job.
    this.dispatchTimer.unref?.();
  }

  /**
   * Processes a single job with tracing and error handling. The delay is
   * already spent — the scheduler holds a job in the queue until it is due.
   */
  private async processJob(job: QueuedJob<Payload>): Promise<void> {
    const baseAttributes: Record<string, string | number | boolean> = {
      "queue.name": this.queueName,
      "queue.job_id": job.jobId ?? "unknown",
    };

    const customAttributes: Record<string, string | number | boolean> = {};
    if (this.spanAttributes) {
      try {
        const attributes = this.spanAttributes(job.payload);
        // Filter out undefined values and convert to the expected type
        for (const [key, value] of Object.entries(attributes)) {
          if (value !== undefined) {
            if (
              typeof value === "string" ||
              typeof value === "number" ||
              typeof value === "boolean"
            ) {
              customAttributes[key] = value;
            }
          }
        }
      } catch (error) {
        // If spanAttributes throws, log error and continue with base attributes only
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.error(
          {
            queueName: this.queueName,
            jobId: job.jobId,
            error: errorMessage,
          },
          "Failed to extract span attributes from payload",
        );
      }
    }
    const attributes = { ...baseAttributes, ...customAttributes };

    try {
      await this.tracer.withActiveSpan(
        "pipeline.process",
        {
          kind: SpanKind.INTERNAL,
          attributes,
        },
        async () => {
          await this.process(job.payload);
        },
      );
      job.resolve();
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      this.logger.error(
        {
          queueName: this.queueName,
          jobId: job.jobId,
          error: errorMessage,
        },
        "Event-sourced queue job failed",
      );
      job.reject(error instanceof Error ? error : new Error(errorMessage));
    }
  }

  /**
   * Memory queue is always ready immediately (no connection to establish).
   */
  async waitUntilReady(): Promise<void> {
    // Memory queue has no connection to wait for
    return;
  }

  /**
   * Gracefully closes the queue processor, waiting for in-flight jobs to complete.
   */
  async close(): Promise<void> {
    this.logger.debug(
      { queueName: this.queueName },
      "Closing memory queue processor",
    );

    if (this.dispatchTimer !== null) {
      clearTimeout(this.dispatchTimer);
      this.dispatchTimer = null;
      this.dispatchTimerAt = Number.POSITIVE_INFINITY;
    }

    // Wait for active jobs to complete (simple polling since we don't track promises)
    while (this.activeCount > 0) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    // Reject any remaining queued jobs
    for (const job of this.queue) {
      job.reject(
        new Error(
          `Queue ${this.queueName} was closed before job could be processed`,
        ),
      );
    }
    this.queue.length = 0;
    this.pendingJobsByDeduplicationId.clear();
    this.suppressedUntilByDeduplicationId.clear();

    this.logger.debug(
      { queueName: this.queueName },
      "Memory queue processor closed successfully",
    );
  }
}
