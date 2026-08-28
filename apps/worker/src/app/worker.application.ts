import {
  WorkerFeatureHandlePort,
  WorkerFeatureInstallerPort,
} from "../features/worker-feature.installer";
import { WorkerEventingRuntime } from "../platform/eventing/worker-eventing.runtime";
import { WorkerRuntime } from "../platform/lifecycle/worker.runtime";

export class WorkerApplication {
  static create(options: {
    runtime: WorkerRuntime;
    featureInstallers: readonly WorkerFeatureInstallerPort[];
    eventing?: WorkerEventingRuntime;
  }): WorkerApplication {
    return new WorkerApplication(options.runtime, options.featureInstallers, options.eventing);
  }

  private readonly featureHandles: WorkerFeatureHandlePort[] = [];
  private started = false;
  private closed = false;
  private starting: Promise<void> | undefined;
  private closing: Promise<void> | undefined;

  private constructor(
    private readonly runtime: WorkerRuntime,
    private readonly featureInstallers: readonly WorkerFeatureInstallerPort[],
    private readonly eventing: WorkerEventingRuntime | undefined,
  ) {}

  async start(): Promise<void> {
    if (this.closed) {
      throw new Error("Worker application is closed.");
    }
    if (this.started) {
      return;
    }
    if (this.starting) {
      return this.starting;
    }

    const starting = this.startApplication();
    this.starting = starting;
    return starting;
  }

  close(): Promise<void> {
    if (this.closing) {
      return this.closing;
    }

    this.closed = true;
    const closing = this.closeApplication();
    this.closing = closing;
    return closing;
  }

  private async startApplication(): Promise<void> {
    try {
      for (const installer of this.featureInstallers) {
        this.featureHandles.push(await installer.install());
      }
      await this.eventing?.start();
      await this.runtime.start();
      this.started = true;
    } catch (error) {
      await this.closeFeatureHandlesBestEffort();
      throw error;
    } finally {
      this.starting = void 0;
    }
  }

  private async closeApplication(): Promise<void> {
    await this.starting?.catch(() => void 0);

    let firstError: unknown;
    try {
      // The Eventing runtime owns the shared queue consumer. Its close path
      // first stops process work and drains the queue before the registry is
      // released. Infrastructure must remain available for that drain.
      await this.eventing?.close();
    } catch (error) {
      firstError = error;
    }

    const featureError = await this.closeFeatureHandlesBestEffort();
    firstError ??= featureError;

    try {
      await this.runtime.close();
    } catch (error) {
      firstError ??= error;
    }

    if (firstError) throw firstError;
  }

  private async closeFeatureHandlesBestEffort(): Promise<unknown> {
    let firstError: unknown;
    for (const handle of this.featureHandles.reverse()) {
      try {
        await handle.close();
      } catch (error) {
        firstError ??= error;
      }
    }
    this.featureHandles.length = 0;
    return firstError;
  }
}
