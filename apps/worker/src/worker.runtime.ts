import { ResourceScope } from "@langwatch/runtime-composition";
import type {
  WorkerHandlePort,
  WorkerLifecyclePort,
  WorkerTransportPort,
} from "./worker-runtime.port";

export {
  WorkerHandlePort,
  WorkerLifecyclePort,
  WorkerTransportPort,
} from "./worker-runtime.port";

export type WorkerRuntimeOptions = {
  lifecycle: WorkerLifecyclePort;
  transport: WorkerTransportPort;
  resources?: ResourceScope;
  ownsResources?: boolean;
};

export class WorkerRuntime {
  static create(options: WorkerRuntimeOptions): WorkerRuntime {
    return new WorkerRuntime(
      options.lifecycle,
      options.transport,
      options.resources ?? new ResourceScope(),
      options.ownsResources ?? true,
    );
  }

  private handle: WorkerHandlePort | undefined;
  private starting: Promise<void> | undefined;
  private closing: Promise<void> | undefined;
  private closed = false;

  private constructor(
    private readonly lifecycle: WorkerLifecyclePort,
    private readonly transport: WorkerTransportPort,
    private readonly resources: ResourceScope,
    private readonly ownsResources: boolean,
  ) {}

  async start(): Promise<void> {
    if (this.closed) {
      throw new Error("Worker runtime is closed.");
    }

    if (this.handle) {
      return;
    }

    const starting = this.starting;
    if (starting) {
      return starting;
    }

    const nextStart = this.startTransport();
    this.starting = nextStart;
    return nextStart;
  }

  close(): Promise<void> {
    const closing = this.closing;
    if (closing) {
      return closing;
    }

    this.closed = true;
    const nextClose = this.closeRuntime();
    this.closing = nextClose;
    return nextClose;
  }

  private async startTransport(): Promise<void> {
    try {
      const handle = await this.transport.start();

      if (this.closed) {
        await handle.shutdown();
        return;
      }

      this.handle = handle;
    } finally {
      this.starting = void 0;
    }
  }

  private async closeRuntime(): Promise<void> {
    const starting = this.starting;
    if (starting) {
      await starting.catch(() => void 0);
    }

    await this.handle?.shutdown();
    await this.lifecycle.close();

    if (this.ownsResources) {
      await this.resources.close();
    }
  }
}
