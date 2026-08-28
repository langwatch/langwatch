import { ResourceScope } from "@langwatch/runtime-composition";
import { ApiApplicationPort, ApiLifecyclePort, type ApiShutdownOptions } from "./api-runtime.port";

export { ApiApplicationPort, ApiLifecyclePort, type ApiShutdownOptions } from "./api-runtime.port";

export type ApiRuntimeOptions<Application, Services> = {
  application: ApiApplicationPort<Application>;
  lifecycle: ApiLifecyclePort<Services>;
  resources?: ResourceScope;
  ownsResources?: boolean;
};

/**
 * Owns one interactive application graph and its process resources.
 *
 * Product composition stays behind nominal ports so this package never learns
 * about the legacy App type or feature catalogue.
 */
export class ApiRuntime<Application, Services> {
  static async create<Application, Services>(
    options: ApiRuntimeOptions<Application, Services>,
  ): Promise<ApiRuntime<Application, Services>> {
    const resources = options.resources ?? new ResourceScope();
    const ownsResources = options.ownsResources ?? true;

    try {
      const services = await options.lifecycle.compose(resources);
      await options.application.compose();
      return new ApiRuntime(options.application, services, resources, ownsResources);
    } catch (error) {
      if (ownsResources) {
        await resources.close();
      }
      throw error;
    }
  }

  private started = false;
  private closed = false;
  private starting: Promise<void> | undefined;
  private closing: Promise<void> | undefined;

  private constructor(
    private readonly applicationPort: ApiApplicationPort<Application>,
    readonly services: Services,
    private readonly resources: ResourceScope,
    private readonly ownsResources: boolean,
  ) {}

  get app(): Application {
    return this.applicationPort.application;
  }

  start(): Promise<void> {
    if (this.closed) {
      throw new Error("API runtime is closed.");
    }

    if (this.started) {
      return Promise.resolve();
    }

    const starting = this.starting;
    if (starting) {
      return starting;
    }

    const nextStart = this.startApplication();
    this.starting = nextStart;
    return nextStart;
  }

  close(options?: ApiShutdownOptions): Promise<void> {
    const closing = this.closing;
    if (closing) {
      return closing;
    }

    this.closed = true;
    const nextClose = this.closeRuntime(options);
    this.closing = nextClose;
    return nextClose;
  }

  private async startApplication(): Promise<void> {
    try {
      await this.applicationPort.start();
      this.started = true;
    } finally {
      this.starting = void 0;
    }
  }

  private async closeRuntime(options?: ApiShutdownOptions): Promise<void> {
    const starting = this.starting;
    if (starting) {
      await starting.catch(() => void 0);
    }

    try {
      await this.applicationPort.close(options);
    } finally {
      if (this.ownsResources) {
        await this.resources.close();
      }
    }
  }
}
