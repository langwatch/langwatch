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
      // A queue readiness or transport-start failure can happen after Eventing
      // has staged work. Drain it while the feature handles and process
      // infrastructure are still available, then release the rest of the
      // process graph. The boot error remains the one the caller receives.
      this.closed = true;
      await this.closeEventingAndFeaturesBestEffort();
      await this.runtime.close().catch(() => void 0);
      throw error;
    } finally {
      this.starting = void 0;
    }
  }

  private async closeApplication(): Promise<void> {
    await this.starting?.catch(() => void 0);

    let firstError: unknown;
    const eventingAndFeatureError = await this.closeEventingAndFeaturesBestEffort();
    firstError ??= eventingAndFeatureError;

    try {
      await this.runtime.close();
    } catch (error) {
      firstError ??= error;
    }

    if (firstError) throw firstError;
  }

  /**
   * Queued Eventing work can retain feature-owned repositories and executors.
   * Its drain therefore completes before feature handles are released.
   */
  private async closeEventingAndFeaturesBestEffort(): Promise<unknown> {
    let firstError: unknown;
    try {
      await this.eventing?.close();
    } catch (error) {
      firstError = error;
    }

    const featureError = await this.closeFeatureHandlesBestEffort();
    return firstError ?? featureError;
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
