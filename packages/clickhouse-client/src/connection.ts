import type { ClickHouseConfiguration, ClickHousePrivateRouteConfiguration } from "./config";
import { createTenantRouter, type TenantDirectory, type TenantRouter } from "./tenancy";

export interface ClickHouseCloseableClient {
  close(): Promise<void>;
}

export interface ClickHouseClientCreationInput {
  url: string;
  instance: string;
  cluster: string;
  maxOpenConnections: number;
}

/** The process supplies the vendor-specific client construction once. */
export abstract class ClickHouseClientFactory<Client extends ClickHouseCloseableClient> {
  abstract create(input: ClickHouseClientCreationInput): Client;
}

export class ClickHouseNotConfiguredError extends Error {
  constructor() {
    super("ClickHouse is not configured for this process.");
    this.name = "ClickHouseNotConfiguredError";
  }
}

export interface ClickHouseConnectionServiceOptions<Client extends ClickHouseCloseableClient> {
  directory: TenantDirectory;
  clientFactory: ClickHouseClientFactory<Client>;
  maxTenantCacheEntries?: number | undefined;
}

export interface ClickHouseInstance<Client extends ClickHouseCloseableClient> {
  target: "shared" | string;
  client: Client;
}

/** Resources returned together to the process composition root. */
export class ClickHouseConnection<Client extends ClickHouseCloseableClient> {
  private closePromise: Promise<void> | undefined;
  private readonly clientByUrl = new Map<string, Client>();
  private readonly privateRoutesByUrl = new Map<string, ClickHousePrivateRouteConfiguration>();

  private constructor(
    private readonly configuration: ClickHouseConfiguration,
    private readonly router: TenantRouter,
    private readonly clientFactory: ClickHouseClientFactory<Client>,
  ) {
    for (const route of configuration.privateRoutes.values()) {
      if (!this.privateRoutesByUrl.has(route.url)) {
        this.privateRoutesByUrl.set(route.url, route);
      }
    }
  }

  static create<Client extends ClickHouseCloseableClient>(input: {
    configuration: ClickHouseConfiguration;
    router: TenantRouter;
    clientFactory: ClickHouseClientFactory<Client>;
  }): ClickHouseConnection<Client> {
    return new ClickHouseConnection(input.configuration, input.router, input.clientFactory);
  }

  async resolve(tenantId: string): Promise<Client> {
    const route = await this.router.route(tenantId);
    if (route.kind === "shared") return this.sharedClient();

    const configuration = this.configuration.privateRoutes.get(route.organizationId);
    if (configuration === undefined) {
      throw new Error(`No configured ClickHouse route for organisation "${route.organizationId}".`);
    }
    return this.clientFor({
      url: configuration.url,
      instance: configuration.organizationId,
      cluster: configuration.cluster,
    });
  }

  /** Builds each physical endpoint once for migrations, schema checks and shutdown. */
  instances(): readonly ClickHouseInstance<Client>[] {
    const instances: ClickHouseInstance<Client>[] = [];
    if (this.configuration.shared !== undefined) {
      instances.push({ target: "shared", client: this.sharedClient() });
    }
    for (const route of this.privateRoutesByUrl.values()) {
      instances.push({
        target: route.organizationId,
        client: this.clientFor({
          url: route.url,
          instance: route.organizationId,
          cluster: route.cluster,
        }),
      });
    }
    return instances;
  }

  /** Closes every created endpoint, retaining the first failure after all cleanup runs. */
  closeOnce(): Promise<void> {
    this.closePromise ??= this.closeAll();
    return this.closePromise;
  }

  private sharedClient(): Client {
    const shared = this.configuration.shared;
    if (shared === undefined) throw new ClickHouseNotConfiguredError();
    return this.clientFor({
      url: shared.url,
      instance: "shared",
      cluster: shared.cluster,
    });
  }

  private clientFor({
    url,
    instance,
    cluster,
  }: {
    url: string;
    instance: string;
    cluster: string;
  }): Client {
    const cached = this.clientByUrl.get(url);
    if (cached !== undefined) return cached;

    const client = this.clientFactory.create({
      url,
      instance,
      cluster,
      maxOpenConnections: this.configuration.poolSizing.size,
    });
    this.clientByUrl.set(url, client);
    return client;
  }

  private async closeAll(): Promise<void> {
    const results = await Promise.allSettled(
      [...this.clientByUrl.values()].map((client) => client.close()),
    );
    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failure !== undefined) throw failure.reason;
  }
}

/** Explicit, side-effect-free-until-called construction of one process connection graph. */
export class ClickHouseConnectionService<Client extends ClickHouseCloseableClient> {
  private constructor(
    private readonly directory: TenantDirectory,
    private readonly clientFactory: ClickHouseClientFactory<Client>,
    private readonly maxTenantCacheEntries: number | undefined,
  ) {}

  static create<Client extends ClickHouseCloseableClient>(
    options: ClickHouseConnectionServiceOptions<Client>,
  ): ClickHouseConnectionService<Client> {
    return new ClickHouseConnectionService(
      options.directory,
      options.clientFactory,
      options.maxTenantCacheEntries,
    );
  }

  connect(configuration: ClickHouseConfiguration): ClickHouseConnection<Client> {
    const routes = new Map<string, string>();
    for (const route of configuration.privateRoutes.values()) {
      routes.set(route.organizationId, route.url);
    }
    const router = createTenantRouter({
      table: { routes, skipped: [], ambiguous: [] },
      directory: this.directory,
      ...(this.maxTenantCacheEntries === undefined
        ? {}
        : { maxCacheEntries: this.maxTenantCacheEntries }),
    });
    return ClickHouseConnection.create({
      configuration,
      router,
      clientFactory: this.clientFactory,
    });
  }
}
