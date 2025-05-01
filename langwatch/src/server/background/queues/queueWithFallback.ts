import {
  Job,
  Queue,
  type JobsOptions,
  type QueueOptions,
  type RedisClient,
} from "bullmq";
import { EventEmitter } from "events";
import { connection } from "../../redis";
import { createLogger } from "../../../utils/logger.server";
import * as Sentry from "@sentry/nextjs";

const logger = createLogger("langwatch:queueWithFallback");

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

  constructor(
    name: string,
    worker: (job: Job<DataType, ResultType, NameType>) => Promise<any>,
    opts?: QueueOptions
  ) {
    super(name, opts, connection ? undefined : (NoOpConnection as any));
    this.worker = worker;
  }

  async add(
    name: NameType,
    data: DataType,
    opts?: JobsOptions
  ): Promise<Job<DataType, ResultType, NameType>> {
    if (!connection) {
      await new Promise((resolve) => setTimeout(resolve, opts?.delay ?? 0));
      await this.worker(new Job(this, name, data, opts));
    }

    try {
      const timeoutState = { state: "waiting" };
      const timeoutPromise = new Promise((resolve, reject) => {
        setTimeout(() => {
          if (timeoutState.state === "waiting") {
            reject(
              new Error("Timed out after 3s trying to insert on the queue")
            );
          } else {
            resolve(undefined);
          }
        }, 3000);
      });

      const job = await Promise.race([
        timeoutPromise,
        super.add(name, data, opts).then((job) => {
          timeoutState.state = "resolved";
          return job;
        }),
      ]);

      return job as Job<DataType, ResultType, NameType>;
    } catch (error) {
      logger.error(
        "Failed sending to redis collector queue inserting trace directly, processing job synchronously.",
        "Exception:",
        error
      );
      Sentry.captureException(error, {
        extra: {
          message:
            "Failed sending to redis collector queue inserting trace directly, processing job synchronously",
          projectId: (data as any)?.projectId,
        },
      });

      return await this.worker(new Job(this, name, data, opts));
    }
  }

  async addBulk(
    jobs: { name: NameType; data: DataType; opts?: JobsOptions }[]
  ): Promise<Job<DataType, ResultType, NameType>[]> {
    if (!connection) {
      await Promise.all(
        jobs.map(async (job) => this.add(job.name, job.data, job.opts))
      );
    }
    return await super.addBulk(jobs);
  }

  // @ts-ignore
  async getJob(
    id: string
  ): Promise<Job<DataType, ResultType, NameType> | undefined> {
    if (!connection) {
      return undefined;
    }
    const timeoutState = { state: "waiting" };
    const timeoutPromise = new Promise((resolve, reject) => {
      setTimeout(() => {
        if (timeoutState.state === "waiting") {
          reject(new Error("Timed out after 3s trying to get job from redis"));
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
      logger.error("Failed getting job from redis", error);
      return undefined;
    }
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
