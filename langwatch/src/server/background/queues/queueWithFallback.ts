import {
  Job,
  Queue,
  type JobsOptions,
  type QueueOptions,
  type RedisClient,
} from "bullmq";
import { EventEmitter } from "events";
import { connection } from "../../redis";

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
    return await super.add(name, data, opts);
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
    return await super.getJob(id);
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
