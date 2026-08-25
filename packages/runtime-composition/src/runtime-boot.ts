import { ResourceScope } from "./resource-scope";

export type RuntimeConfigResolver<Config> = {
  resolve(source: Readonly<Record<string, unknown>>): Config;
};

export type RuntimeBootOptions<Config, Application, Infrastructure = undefined> = {
  config: RuntimeConfigResolver<Config>;
  resources?: ResourceScope;
  createInfrastructure?: (
    config: Config,
    resources: ResourceScope,
  ) => Infrastructure | Promise<Infrastructure>;
  createApplication: (
    config: Config,
    infrastructure: Infrastructure,
    resources: ResourceScope,
  ) => Application | Promise<Application>;
  initializeApplication?: (
    application: Application,
    config: Config,
    infrastructure: Infrastructure,
    resources: ResourceScope,
  ) => void | Promise<void>;
  checkReadiness?: (
    application: Application,
    config: Config,
    infrastructure: Infrastructure,
  ) => void | Promise<void>;
  startTransport?: (
    application: Application,
    config: Config,
    infrastructure: Infrastructure,
  ) => void | RuntimeTransport | Promise<void | RuntimeTransport>;
};

export type RuntimeTransport = {
  close(): void | Promise<void>;
};

export type BootedRuntime<Config, Application> = {
  readonly config: Config;
  readonly application: Application;
  close(): Promise<void>;
};

/**
 * Explicit, failure-safe process boot. Configuration is resolved before any
 * owned resource is created; listening starts only after the graph and its
 * readiness checks succeed.
 */
export class RuntimeBoot<Config, Application, Infrastructure = undefined> {
  private bootPromise: Promise<BootedRuntime<Config, Application>> | undefined;

  constructor(
    private readonly options: RuntimeBootOptions<Config, Application, Infrastructure>,
  ) {}

  boot(
    source: Readonly<Record<string, unknown>>,
  ): Promise<BootedRuntime<Config, Application>> {
    this.bootPromise ??= this.run(source);
    return this.bootPromise;
  }

  private async run(
    source: Readonly<Record<string, unknown>>,
  ): Promise<BootedRuntime<Config, Application>> {
    // Deliberately resolve before constructing a scope or invoking any
    // infrastructure factory. Invalid configuration cannot leak resources.
    const config = this.options.config.resolve(source);
    const resources = this.options.resources ?? new ResourceScope();

    try {
      const infrastructure = await this.options.createInfrastructure?.(config, resources);
      const app = await this.options.createApplication(
        config,
        infrastructure as Infrastructure,
        resources,
      );
      if (hasClose(app)) resources.own("application", () => app.close());

      await this.options.initializeApplication?.(
        app,
        config,
        infrastructure as Infrastructure,
        resources,
      );
      await this.options.checkReadiness?.(app, config, infrastructure as Infrastructure);

      const transport = await this.options.startTransport?.(
        app,
        config,
        infrastructure as Infrastructure,
      );
      if (transport) resources.own("transport", () => transport.close());

      let closed = false;
      return {
        config,
        application: app,
        async close() {
          if (closed) return;
          closed = true;
          await resources.close();
        },
      };
    } catch (error) {
      // App and infrastructure that registered themselves in the scope are
      // closed even when a later phase fails.
      await resources.close().catch(() => undefined);
      throw error;
    }
  }
}

function hasClose(value: unknown): value is { close(): void | Promise<void> } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { close?: unknown }).close === "function"
  );
}
