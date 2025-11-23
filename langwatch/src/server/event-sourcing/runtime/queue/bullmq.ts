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
      throw new Error(
        "BullMQ queue processor requires Redis connection. Use memory implementation instead.",
      );
    }

    this.spanAttributes = spanAttributes;
    this.delay = delay;

    // Derive queue name with braces and job name without braces
    this.queueName = name;
    this.jobName = name;
    this.makeJobId = makeJobId;
    this.process = process;

    const queueOptions: QueueOptions = {
      connection,
      telemetry: new BullMQOtel(this.queueName),
      defaultJobOptions: {
        attempts: 15,
        backoff: {
          type: "exponential",
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
    this.queue = new Queue<Payload, unknown, string>(this.queueName, queueOptions);

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

          // For ordering errors, the error will be retried by BullMQ with backoff
          // The early ordering check in handleEvent should prevent most of these,
          // but if they occur, they indicate the previous event completed between
          // the early check and lock acquisition (race condition)
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
