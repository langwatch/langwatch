import { ResourceScope } from "./resource-scope.ts";

export interface RuntimeService {
  readonly name: string;
  start(): void | Promise<void>;
  stop(): void | Promise<void>;
}

/** Serialises lifecycle transitions and owns rollback of partially started services. */
export class RuntimeLifecycle {
  private startResult: Promise<void> | undefined;
  private stopResult: Promise<void> | undefined;
  private readonly started = new ResourceScope();

  constructor(
    private readonly services: readonly RuntimeService[],
    private readonly resources: ResourceScope,
  ) {}

  start(): Promise<void> {
    if (this.stopResult) {
      return Promise.reject(new Error("Cannot start a stopped runtime."));
    }
    this.startResult ??= Promise.resolve().then(() => this.startServices());
    return this.startResult;
  }

  stop(): Promise<void> {
    this.stopResult ??= Promise.resolve().then(async () => {
      if (this.startResult) {
        try {
          await this.startResult;
        } catch {
          // Rollback has finished; closing again shares any recorded cleanup failure.
        }
      }
      await this.close();
    });
    return this.stopResult;
  }

  private async startServices(): Promise<void> {
    try {
      for (const service of this.services) {
        this.started.own(service.name, () => service.stop());
        await service.start();
      }
    } catch (error) {
      await cleanupAfterFailure(error, () => this.close());
    }
  }

  private async close(): Promise<void> {
    const shutdown = new ResourceScope();
    shutdown.own("feature resources", () => this.resources.close());
    shutdown.own("started services", () => this.started.close());
    await shutdown.close();
  }
}

/** Retains the triggering failure and reports cleanup failures without losing either. */
export async function cleanupAfterFailure(
  failure: unknown,
  close: () => Promise<void>,
): Promise<never> {
  try {
    await close();
  } catch (cleanupError) {
    throw new AggregateError([failure, cleanupError], "Runtime failed and cleanup also failed.", {
      cause: failure,
    });
  }
  throw failure;
}
