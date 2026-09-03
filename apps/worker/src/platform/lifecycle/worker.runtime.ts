import { ResourceScope } from "@langwatch/runtime-composition";
import type {
  WorkerHandlePort,
  WorkerLifecyclePort,
  WorkerTransportPort,
} from "./worker-runtime.port";

export { WorkerHandlePort, WorkerLifecyclePort, WorkerTransportPort } from "./worker-runtime.port";

export type WorkerRuntimeOptions = {
  lifecycle: WorkerLifecyclePort;
  transport: WorkerTransportPort;
  resources?: ResourceScope;
};

export class WorkerRuntime {
  static create(options: WorkerRuntimeOptions): WorkerRuntime {
    const resources = options.resources ?? new ResourceScope();
    return new WorkerRuntime(
      options.lifecycle,
      options.transport,
      resources,
      options.resources === undefined,
    );
  }

  private handle: WorkerHandlePort | undefined;
  private starting: Promise<void> | undefined;
  private draining: Promise<void> | undefined;
  private resourcesClosing: Promise<void> | undefined;
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
    if (this.starting) {
      return this.starting;
    }

    const starting = this.startTransport();
    this.starting = starting;
    return starting;
  }

  close(): Promise<void> {
    if (this.closing) {
      return this.closing;
    }

    this.closed = true;
    const closing = this.closeRuntime();
    this.closing = closing;
    return closing;
  }

  /** Stops queue intake without releasing process infrastructure. */
  drain(): Promise<void> {
    this.closed = true;
    this.draining ??= this.drainTransport();
    return this.draining;
  }

  /** Releases lifecycle-owned technical resources after telemetry has flushed. */
  closeResources(): Promise<void> {
    this.resourcesClosing ??= this.closeLifecycleAndResources();
    return this.resourcesClosing;
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
    let firstError: unknown;
    try {
      await this.drain();
    } catch (error) {
      firstError = error;
    }
    try {
      await this.closeResources();
    } catch (error) {
      firstError ??= error;
    }
    if (firstError) {
      throw firstError;
    }
  }

  private async drainTransport(): Promise<void> {
    await this.starting?.catch(() => void 0);
    try {
      await this.handle?.shutdown();
    } finally {
      this.handle = void 0;
    }
  }

  private async closeLifecycleAndResources(): Promise<void> {
    let firstError: unknown;
    try {
      await this.lifecycle.close();
    } catch (error) {
      firstError ??= error;
    }
    if (this.ownsResources) {
      try {
        await this.resources.close();
      } catch (error) {
        firstError ??= error;
      }
    }
    if (firstError) {
      throw firstError;
    }
  }
}
