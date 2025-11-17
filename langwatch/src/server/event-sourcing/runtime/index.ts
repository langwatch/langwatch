import type { Event, Projection, AggregateType } from "../library";
import { EventSourcingService } from "../library";
import type {
  EventSourcingPipelineDefinition,
  RegisteredPipeline,
} from "../library/pipeline.types";
import type {
  EventSourcedQueueDefinition,
  EventSourcedQueueProcessor,
} from "./index.types";
import {
  Queue,
  Worker,
  type JobsOptions,
  type QueueOptions,
  type WorkerOptions,
} from "bullmq";
import { BullMQOtel } from "bullmq-otel";
import { connection } from "../../redis";
import { createLogger } from "../../../utils/logger";
import { getLangWatchTracer } from "langwatch";
import { SpanKind } from "@opentelemetry/api";
import type { SemConvAttributes } from "langwatch/observability";

export class EventSourcingPipeline<
  AggregateId = string,
  EventType extends Event<AggregateId> = Event<AggregateId>,
  ProjectionType extends Projection<AggregateId> = Projection<AggregateId>,
> implements RegisteredPipeline<AggregateId, EventType, ProjectionType>
{
  public readonly name!: string;
  public readonly aggregateType!: AggregateType;
  public readonly service!: EventSourcingService<
    AggregateId,
    EventType,
    ProjectionType
  >;

  constructor(
    definition: EventSourcingPipelineDefinition<
      AggregateId,
      EventType,
      ProjectionType
    >,
  ) {
    // Use Object.defineProperty to make properties truly readonly at runtime
    Object.defineProperty(this, "name", {
      value: definition.name,
      writable: false,
      enumerable: true,
      configurable: false,
    });
    Object.defineProperty(this, "aggregateType", {
      value: definition.aggregateType,
      writable: false,
      enumerable: true,
      configurable: false,
    });
    Object.defineProperty(this, "service", {
      value: new EventSourcingService<AggregateId, EventType, ProjectionType>({
        aggregateType: definition.aggregateType,
        eventStore: definition.eventStore,
        projectionStore: definition.projectionStore,
        eventHandler: definition.eventHandler,
      }),
      writable: false,
      enumerable: true,
      configurable: false,
    });
  }
}

export class EventSourcedQueueProcessorImpl<Payload>
  implements EventSourcedQueueProcessor<Payload>
{
  private readonly logger = createLogger("langwatch:event-sourcing:queue");
  private readonly tracer: ReturnType<typeof getLangWatchTracer>;
  private readonly queueName: string;
  private readonly jobName: string;
  private readonly makeJobId?: (payload: Payload) => string;
  private readonly process: (payload: Payload) => Promise<void>;
  private readonly spanAttributes?: (payload: Payload) => SemConvAttributes;
  private readonly queue?: Queue<Payload, void, string>;
  private readonly worker?: Worker<Payload, void, string>;
  private readonly isInline: boolean;

  private readonly delay?: number;

  constructor(definition: EventSourcedQueueDefinition<Payload>) {
    const {
      queueName,
      jobName,
      makeJobId,
      process,
      options,
      delay,
      spanAttributes,
    } = definition;

    this.tracer = getLangWatchTracer("langwatch.event-sourcing.queue");
    this.spanAttributes = spanAttributes;
    this.delay = delay;

    this.queueName = queueName;
    this.jobName = jobName;
    this.makeJobId = makeJobId;
    this.process = process;

    if (!connection) {
      this.isInline = true;
      this.logger.info(
        { queueName },
        "No Redis connection available, queue will execute jobs inline",
      );
      return;
    }

    this.isInline = false;

    const queueOptions: QueueOptions = {
      connection,
      telemetry: new BullMQOtel(queueName),
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 2000,
        },
        delay: this.delay ?? 0,
        removeOnComplete: {
          age: 3600,
          count: 1000,
        },
        removeOnFail: {
          age: 60 * 60 * 24 * 7,
        },
      },
    };
    this.queue = new Queue<Payload, void, string>(queueName, queueOptions);

    const workerOptions: WorkerOptions = {
      connection,
      concurrency: options?.concurrency ?? 5,
      telemetry: new BullMQOtel(queueName),
    };
    this.worker = new Worker<Payload, void, string>(
      queueName,
      async (job) => {
        const baseAttributes: Record<string, string | number | boolean> = {
          "queue.name": queueName,
          "queue.job_name": jobName,
          "queue.job_id": job.id ?? "unknown",
        };

        const customAttributes = this.spanAttributes
          ? this.spanAttributes(job.data)
          : {};
        const attributes = { ...baseAttributes, ...customAttributes };

        await this.tracer.withActiveSpan(
          "pipeline.process",
          {
            kind: SpanKind.CONSUMER,
            attributes,
          },
          async () => {
            await this.process(job.data);
          },
        );
      },
      workerOptions,
    );

    this.worker.on("ready", () => {
      this.logger.info({ queueName }, "Event-sourced queue worker ready");
    });

    this.worker.on("failed", (job, error) => {
      this.logger.error(
        {
          queueName,
          jobId: job?.id,
          error: error instanceof Error ? error.message : String(error),
        },
        "Event-sourced queue job failed",
      );
    });
  }

  async send(payload: Payload): Promise<void> {
    if (this.isInline) {
      const baseAttributes: Record<string, string | number | boolean> = {
        "queue.name": this.queueName,
        "queue.job_name": this.jobName,
      };

      const customAttributes = this.spanAttributes
        ? this.spanAttributes(payload)
        : {};
      const attributes = { ...baseAttributes, ...customAttributes };

      await this.tracer.withActiveSpan(
        "pipeline.process",
        {
          kind: SpanKind.INTERNAL,
          attributes,
        },
        async () => {
          await this.process(payload);
        },
      );
      return;
    }

    const jobId = this.makeJobId ? this.makeJobId(payload) : void 0;
    const opts: JobsOptions = {
      ...(jobId ? { jobId } : {}),
      ...(this.delay !== void 0 ? { delay: this.delay } : {}),
      // When jobId is provided and a job with the same ID exists, BullMQ will
      // automatically replace it if it's still waiting. This enables batching/debouncing.
    };

    await this.tracer.withActiveSpan(
      `EventSourcedQueue.send.${this.queueName}`,
      {
        kind: SpanKind.PRODUCER,
        attributes: {
          "queue.name": this.queueName,
          "queue.job_name": this.jobName,
          "queue.job_id": jobId ?? "auto",
        },
      },
      async () => {
        const addJob = this.queue!.add.bind(this.queue!) as (
          name: string,
          data: Payload,
          opts?: JobsOptions,
        ) => Promise<unknown>;
        await addJob(this.jobName, payload, opts);
      },
    );
  }

  /**
   * Gracefully closes the queue processor, waiting for in-flight jobs to complete.
   * Should be called during application shutdown.
   */
  async close(): Promise<void> {
    if (this.isInline) {
      // No cleanup needed for inline mode
      return;
    }

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

// Export singleton instance
export { eventSourcing } from "./eventSourcing";
export type { EventSourcing } from "./eventSourcing";
