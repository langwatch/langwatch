import { SpanKind } from "@opentelemetry/api";
import {
  Job,
  type JobsOptions,
  Queue,
  type QueueOptions,
  type RedisClient,
} from "bullmq";
import { EventEmitter } from "events";
import { getLangWatchTracer } from "langwatch";
import { createLogger } from "../../../utils/logger/server";
import { connection } from "../../redis";
import {
  type JobContextMetadata,
  createContextFromJobData,
  getJobContextMetadata,
  runWithContext,
} from "../../context/asyncContext";

const logger = createLogger("langwatch:queueWithFallback");

/**
 * Container type for job data that wraps the payload and context metadata.
 * Used to propagate request context through the queue.
 */
type JobContainer<DataType> = {
  __payload: DataType;
  __context?: JobContextMetadata;
};

// Queue that falls back to calling the worker directly if the queue is not available
export class QueueWithFallback<
  DataType,
  ResultType,
  NameType extends string,
> extends Queue<
  DataType,
  ResultType,
  NameType,
  DataType,
  ResultType,
  NameType
> {
  private worker: (job: Job<DataType, ResultType, NameType>) => Promise<any>;
  private tracer = getLangWatchTracer("langwatch.queueWithFallback");

  constructor(
    name: string,
    worker: (job: Job<DataType, ResultType, NameType>) => Promise<any>,
    opts?: QueueOptions,
  ) {
    super(name, opts, connection ? undefined : (NoOpConnection as any));
    this.worker = worker;
  }

  async add(
    name: NameType,
    data: DataType,
    opts?: JobsOptions,
  ): Promise<Job<DataType, ResultType, NameType>> {
    // Capture current context to propagate to job processing
    const contextMetadata = getJobContextMetadata();

    return await this.tracer.withActiveSpan(
      `FallbackQueue${this.name}.add`,
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "queue.name": name,
          "queue.id": opts?.jobId,
          ...(contextMetadata.projectId && { "tenant.id": contextMetadata.projectId }),
        },
      },
      async () => {
        // Wrap data with context for propagation
        const wrappedData = {
          __payload: data,
          __context: contextMetadata,
        } as unknown as DataType;

        if (!connection) {
          await new Promise((resolve) => setTimeout(resolve, opts?.delay ?? 0));
          // Restore context when executing fallback worker
          const requestContext = createContextFromJobData(contextMetadata);
          return await runWithContext(requestContext, async () => {
            return await this.worker(new Job(this, name, data, opts));
          });
        }

        try {
          const timeoutState = { state: "waiting" };
          const timeoutPromise = new Promise((resolve, reject) => {
            setTimeout(() => {
              if (timeoutState.state === "waiting") {
                reject(
                  new Error(
                    `Timed out after 3s trying to insert on the queue ${this.name}`,
                  ),
                );
              } else {
                resolve(undefined);
              }
            }, 3000);
          });

          const job = await Promise.race([
            timeoutPromise,
            super.add(name, wrappedData, opts).then((job) => {
              timeoutState.state = "resolved";
              return job;
            }),
          ]);

          logger.info(
            {
              jobId: opts?.jobId,
              queueName: this.name,
              projectId: contextMetadata.projectId,
            },
            "Job scheduled",
          );

          return job as Job<DataType, ResultType, NameType>;
        } catch (error) {
          logger.warn(
            { error, projectId: contextMetadata.projectId },
            `failed sending to redis ${this.name} inserting trace directly, attempting to process job synchronously`,
          );

          // Restore context when executing fallback worker
          const requestContext = createContextFromJobData(contextMetadata);
          return await runWithContext(requestContext, async () => {
            return await this.worker(new Job(this, name, data, opts));
          });
        }
      },
    );
  }

  async addBulk(
    jobs: { name: NameType; data: DataType; opts?: JobsOptions }[],
  ): Promise<Job<DataType, ResultType, NameType>[]> {
    // Capture current context to propagate to job processing
    const contextMetadata = getJobContextMetadata();

    return await this.tracer.withActiveSpan(
      `FallbackQueue${this.name}.addBulk`,
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "queue.name": jobs.map((job) => job.name).join(","),
          "jobs.count": jobs.length,
          ...(contextMetadata.projectId && { "tenant.id": contextMetadata.projectId }),
        },
      },
      async () => {
        if (!connection) {
          // Restore context when executing fallback worker
          const requestContext = createContextFromJobData(contextMetadata);
          return await runWithContext(requestContext, async () => {
            return await Promise.all(
              jobs.map(async (job) => this.add(job.name, job.data, job.opts)),
            );
          });
        }

        // Wrap each job's data with context
        const wrappedJobs = jobs.map((job) => ({
          ...job,
          data: {
            __payload: job.data,
            __context: contextMetadata,
          } as unknown as DataType,
        }));

        logger.info(
          {
            queueName: this.name,
            jobCount: jobs.length,
            projectId: contextMetadata.projectId,
          },
          "Bulk jobs scheduled",
        );

        return await super.addBulk(wrappedJobs);
      },
    );
  }

  // @ts-ignore
  async getJob(
    id: string,
  ): Promise<Job<DataType, ResultType, NameType> | undefined> {
    return await this.tracer.withActiveSpan(
      `FallbackQueue${this.name}.getJob`,
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "queue.name": id,
        },
      },
      async () => {
        if (!connection) {
          return undefined;
        }

        const timeoutState = { state: "waiting" };
        const timeoutPromise = new Promise((resolve, reject) => {
          setTimeout(() => {
            if (timeoutState.state === "waiting") {
              reject(
                new Error("Timed out after 3s trying to get job from redis"),
              );
            } else {
              resolve(undefined);
            }
          }, 3000);
        });

        try {
          const job = await Promise.race([
            timeoutPromise,
            super.getJob(id).then((job) => {
              timeoutState.state = "resolved";
              return job;
            }),
          ]);

          return job as Job<DataType, ResultType, NameType>;
        } catch (error) {
          logger.error({ error }, "failed getting job from redis");
          return undefined;
        }
      },
    );
  }
}

class NoOpConnection extends EventEmitter {
  constructor() {
    super();
  }
  async reconnect(): Promise<void> {
    return void 0;
  }
  async disconnect(): Promise<void> {
    return void 0;
  }
  async waitUntilReady(): Promise<void> {
    return void 0;
  }
  async close(): Promise<void> {
    return void 0;
  }
  get client(): Promise<RedisClient> {
    return Promise.resolve(null as any);
  }
}
