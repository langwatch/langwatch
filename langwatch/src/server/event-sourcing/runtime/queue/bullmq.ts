import {
  Queue,
  Worker,
  type JobsOptions,
  type QueueOptions,
  type WorkerOptions,
} from "bullmq";
import { BullMQOtel } from "bullmq-otel";
import { connection } from "../../../redis";
import { createLogger } from "../../../../utils/logger";
import { trace } from "@opentelemetry/api";
import type { SemConvAttributes } from "langwatch/observability";
import type {
  EventSourcedQueueDefinition,
  EventSourcedQueueProcessor,
} from "../../library/queues";
import {
  isSequentialOrderingError,
  extractPreviousSequenceNumber,
  ConfigurationError,
} from "../../library/services/errorHandling";

export class EventSourcedQueueProcessorBullMq<Payload>
  implements EventSourcedQueueProcessor<Payload>
{
  private readonly logger = createLogger("langwatch:event-sourcing:queue");
  private readonly queueName: string;
  private readonly jobName: string;
  private readonly makeJobId?: (payload: Payload) => string;
  private readonly process: (payload: Payload) => Promise<void>;
  private readonly spanAttributes?: (payload: Payload) => SemConvAttributes;
  private readonly queue: Queue<Payload, unknown, string>;
  private readonly worker: Worker<Payload>;
  private readonly delay?: number;

  constructor(definition: EventSourcedQueueDefinition<Payload>) {
    const { name, makeJobId, process, options, delay, spanAttributes } =
      definition;

    if (!connection) {
      throw new ConfigurationError(
        "BullMQQueueProcessor",
        "BullMQ queue processor requires Redis connection. Use memory implementation instead.",
      );
    }

    this.spanAttributes = spanAttributes;
    this.delay = delay;

    this.queueName = name;
    this.jobName = "queue";
    this.makeJobId = makeJobId;
    this.process = process;

    const queueOptions: QueueOptions = {
      connection,
      telemetry: new BullMQOtel(this.queueName),
      defaultJobOptions: {
        attempts: 15,
        backoff: {
          // Due to the sequential nature of event processing, we don't really want to use exponential backoff, as that
          // could cause a chain reaction of events that are laggier and laggier in processing, causing the system to
          // grind to a halt. Quick retires, coupled with our custom delay logic for event ordering errors, will
          // produce a much more resilient system.
          type: "fixed",
          delay: 2000,
        },
        delay: this.delay ?? 0,
        removeOnComplete: {
          age: 3600, // 1 hour
          count: 1000,
        },
        removeOnFail: {
          age: 60 * 60 * 24 * 7, // 7 days
        },
      },
    };
    this.queue = new Queue<Payload, unknown, string>(
      this.queueName,
      queueOptions,
    );

    const workerOptions: WorkerOptions = {
      connection,
      concurrency: options?.concurrency ?? 5,
      telemetry: new BullMQOtel(this.queueName),
    };
    this.worker = new Worker<Payload>(
      this.queueName,
      async (job) => {
        const customAttributes = this.spanAttributes
          ? this.spanAttributes(job.data)
          : {};

        const span = trace.getActiveSpan();
        span?.setAttributes({
          ...customAttributes,
        });

        this.logger.debug(
          {
            queueName: this.queueName,
            jobId: job.id,
          },
          "Processing queue job",
        );

        try {
          await this.process(job.data);
          this.logger.debug(
            {
              queueName: this.queueName,
              jobId: job.id,
            },
            "Queue job processed successfully",
          );
        } catch (error) {
          // Detect ordering errors for better logging and potential future smart retry logic
          const isOrderingError = isSequentialOrderingError(error);
          const previousSequence = isOrderingError
            ? extractPreviousSequenceNumber(error)
            : null;

          this.logger.error(
            {
              queueName: this.queueName,
              jobId: job.id,
              error: error instanceof Error ? error.message : String(error),
              errorStack: error instanceof Error ? error.stack : void 0,
              isOrderingError,
              ...(previousSequence !== null
                ? { previousSequenceNumber: previousSequence }
                : {}),
            },
            isOrderingError
              ? "Queue job failed due to ordering violation - previous event not yet processed"
              : "Queue job processing failed",
          );

          // For ordering errors, we should NOT retry immediately because:
          // 1. The event is already stored in the database
          // 2. The sequence number calculation will include it, causing sequence numbers to grow
          // 3. The previous event needs to be processed first, which will happen naturally
          // Instead, we move the job to delayed state to retry later when the previous event is processed
          // IMPORTANT: We use progressive delays to prevent jobs from hitting retry limits when many
          // events arrive simultaneously. Ordering errors should wait indefinitely until their turn.
          if (isOrderingError) {
            // Use progressive delay based on attempts made:
            // - Base delay: 2 seconds
            // - Progressive: +1 second per attempt (capped at 20 seconds max)
            // This gives earlier events time to complete while preventing later events from
            // hitting retry limits when processing 30+ events sequentially
            const baseDelayMs = 2000;
            const progressiveDelayMs = Math.min(
              baseDelayMs + job.attemptsMade * 1000,
              20000, // Cap at 30 seconds
            );
            const delayedTimestamp = Date.now() + progressiveDelayMs;

            try {
              await job.moveToDelayed(delayedTimestamp);

              this.logger.debug(
                {
                  queueName: this.queueName,
                  jobId: job.id,
                  delayMs: progressiveDelayMs,
                  attemptsMade: job.attemptsMade,
                  previousSequenceNumber: previousSequence,
                },
                "Ordering error: moved job to delayed state with progressive delay",
              );

              // Don't throw - job is moved to delayed state
              // Note: moveToDelayed doesn't increment attemptsMade, so ordering errors
              // won't consume retry attempts. The job will retry indefinitely until
              // the previous event is processed.
              return;
            } catch (moveError) {
              // If moveToDelayed fails (e.g., job already processed), log and throw original error
              this.logger.warn(
                {
                  queueName: this.queueName,
                  jobId: job.id,
                  moveError:
                    moveError instanceof Error
                      ? moveError.message
                      : String(moveError),
                },
                "Failed to move ordering error job to delayed state, will retry normally",
              );
              // Fall through to throw original error
            }
          }

          // For non-ordering errors, throw to trigger normal retry logic
          throw error;
        }
      },
      workerOptions,
    );

    this.worker.on("ready", () => {
      this.logger.info(
        { queueName: this.queueName },
        "Event-sourced queue worker ready",
      );
    });

    this.worker.on("failed", (job, error) => {
      this.logger.error(
        {
          queueName: this.queueName,
          jobId: job?.id,
          error: error instanceof Error ? error.message : String(error),
        },
        "Event-sourced queue job failed",
      );
    });
  }

  async send(payload: Payload): Promise<void> {
    const jobId = this.makeJobId ? this.makeJobId(payload) : void 0;
    const opts: JobsOptions = {
      ...(jobId ? { jobId } : {}),
      ...(this.delay !== void 0 ? { delay: this.delay } : {}),
      // When jobId is provided and a job with the same ID exists, BullMQ will
      // automatically replace it if it's still waiting. This enables batching/debouncing.
    };

    const customAttributes = this.spanAttributes
      ? this.spanAttributes(payload)
      : {};

    const span = trace.getActiveSpan();
    span?.setAttributes({ ...customAttributes });

    await this.queue.add(
      // @ts-expect-error - jobName is a string, this is stupid typing from BullMQ
      this.jobName,
      payload,
      opts,
    );
  }

  /**
   * Gracefully closes the queue processor, waiting for in-flight jobs to complete.
   * Should be called during application shutdown.
   */
  async close(): Promise<void> {
    this.logger.info({ queueName: this.queueName }, "Closing queue processor");

    try {
      // Close worker first to stop accepting new jobs
      if (this.worker) {
        await this.worker.close();
        this.logger.debug({ queueName: this.queueName }, "Worker closed");
      }

      // Close queue
      if (this.queue) {
        await this.queue.close();
        this.logger.debug({ queueName: this.queueName }, "Queue closed");
      }

      this.logger.info(
        { queueName: this.queueName },
        "Queue processor closed successfully",
      );
    } catch (error) {
      this.logger.error(
        {
          queueName: this.queueName,
          error: error instanceof Error ? error.message : String(error),
        },
        "Error closing queue processor",
      );
      throw error;
    }
  }
}
