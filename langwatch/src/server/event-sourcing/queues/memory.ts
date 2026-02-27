import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import type { SemConvAttributes } from "langwatch/observability";
import { createLogger } from "../../../utils/logger/server";
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
  delay?: number;
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
> implements EventSourcedQueueProcessor<Payload> {
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
  private activeCount = 0;
  private shutdownRequested = false;

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

    this.logger.info(
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

  async send(payload: Payload, options?: QueueSendOptions<Payload>): Promise<void> {
    // Memory implementation allows sends after close since it has no persistent state
    // This is different from BullMQ which should reject sends after shutdown

    const dedup = options?.deduplication ?? this.deduplication;
    const effectiveDelay = options?.delay ?? this.delay;

    const jobId = this.generateJobId(payload);
    const deduplicationId = dedup?.makeId(payload);

    // Simple job deduplication: replace existing job with same deduplication ID
    if (deduplicationId) {
      const existingJob =
        this.pendingJobsByDeduplicationId.get(deduplicationId);
      if (existingJob) {
        existingJob.payload = payload;
        this.logger.debug(
          { queueName: this.queueName, jobId, deduplicationId },
          "Replaced existing job with same deduplication ID",
        );
        return;
      }
    }

    // Queue job and process asynchronously
    return new Promise<void>((resolve, reject) => {
      const job: QueuedJob<Payload> = {
        payload,
        jobId,
        deduplicationId,
        delay: effectiveDelay,
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

  async sendBatch(payloads: Payload[], options?: QueueSendOptions<Payload>): Promise<void> {
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

    const job = this.queue.shift();
    if (!job) {
      return;
    }

    this.activeCount++;
    void this.processJob(job).finally(() => {
      this.activeCount--;
      if (job.deduplicationId) {
        this.pendingJobsByDeduplicationId.delete(job.deduplicationId);
      }
      // Try to process next job
      this.tryProcessNext();
    });
  }

  /**
   * Processes a single job with tracing and error handling.
   */
  private async processJob(job: QueuedJob<Payload>): Promise<void> {
    // Apply delay if configured (per-job delay takes precedence over instance delay)
    const delay = job.delay;
    if (delay && delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    const baseAttributes: Record<string, string | number | boolean> = {
      "queue.name": this.queueName,
      "queue.job_id": job.jobId ?? "unknown",
    };

    let customAttributes: Record<string, string | number | boolean> = {};
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
    this.logger.info(
      { queueName: this.queueName },
      "Closing memory queue processor",
    );

    this.shutdownRequested = true;

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

    this.logger.info(
      { queueName: this.queueName },
      "Memory queue processor closed successfully",
    );
  }
}
