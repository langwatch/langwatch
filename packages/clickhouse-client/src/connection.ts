import type { ClickHouseConfiguration } from "./config";
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

export class ClickHouseConnectionClosedError extends Error {
  constructor() {
    super("ClickHouse connection is closing or has already closed.");
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
  private readonly endpointByUrl = new Map<
    string,
    { instance: string; cluster: string; target: "shared" | string }
  >();
  private state: "open" | "closing" | "closed" = "open";

  private constructor(
    private readonly configuration: ClickHouseConfiguration,
    private readonly router: TenantRouter,
    private readonly clientFactory: ClickHouseClientFactory<Client>,
  ) {
    const shared = configuration.shared;
    if (shared !== undefined) {
      this.endpointByUrl.set(shared.url, {
        instance: "shared",
        cluster: shared.cluster,
        target: "shared",
      });
    }
    const privateRoutes = [...configuration.privateRoutes.values()].sort((left, right) =>
      left.organizationId.localeCompare(right.organizationId),
    );
    for (const route of privateRoutes) {
      if (this.endpointByUrl.has(route.url)) continue;
      this.endpointByUrl.set(route.url, {
        instance: route.organizationId,
        cluster: route.cluster,
        target: route.organizationId,
      });
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
    this.assertOpen();
    const route = await this.router.route(tenantId);
    this.assertOpen();
    return route.kind === "shared" ? this.shared() : this.resolveOrganization(route.organizationId);
  }

  /** Resolves a known organisation without a directory lookup. */
  resolveOrganization(organizationId: string): Client {
    this.assertOpen();
    const route = this.configuration.privateRoutes.get(organizationId);
    if (route === undefined) return this.shared();
    return this.clientFor(route.url);
  }

  /** Returns the shared endpoint when this process is configured to have one. */
  shared(): Client {
    this.assertOpen();
    const shared = this.configuration.shared;
    if (shared === undefined) throw new ClickHouseNotConfiguredError();
    return this.clientFor(shared.url);
  }

  /** Builds each physical endpoint once for migrations, schema checks and shutdown. */
  instances(): readonly ClickHouseInstance<Client>[] {
    this.assertOpen();
    const instances: ClickHouseInstance<Client>[] = [];
    for (const [url, endpoint] of this.endpointByUrl) {
      instances.push({ target: endpoint.target, client: this.clientFor(url) });
    }
    return instances;
  }

  /** Lists only endpoints already materialised by a caller; never creates one. */
  createdInstances(): readonly ClickHouseInstance<Client>[] {
    this.assertOpen();
    return [...this.clientByUrl].map(([url, client]) => {
      const endpoint = this.endpointByUrl.get(url);
      if (endpoint === undefined)
        throw new Error(`No configured ClickHouse endpoint for URL "${url}".`);
      return { target: endpoint.target, client };
    });
  }

  /** Clears cached tenant-directory answers without changing endpoint clients. */
  invalidateTenantCache(): void {
    this.assertOpen();
    this.router.invalidateAll();
  }

  /**
   * Drops materialised private endpoint clients while keeping this process
   * connection graph usable. This is the compatibility lifecycle for callers
   * that historically cleared only the private-client cache; it is not process
   * shutdown and therefore must not close a shared endpoint.
   */
  async clearPrivateClients(): Promise<void> {
    this.assertOpen();
    const privateUrls = [...this.clientByUrl.keys()].filter((url) => {
      const endpoint = this.endpointByUrl.get(url);
      return endpoint?.target !== "shared";
    });
    const clients = privateUrls.map((url) => this.clientByUrl.get(url));
    const results = await Promise.allSettled(
      clients
        .filter((client): client is Client => client !== undefined)
        .map((client) => client.close()),
    );
    for (const url of privateUrls) this.clientByUrl.delete(url);
    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failure !== undefined) throw failure.reason;
  }

  /** Number of physical private endpoint clients currently materialised. */
  privateClientCount(): number {
    this.assertOpen();
    return [...this.clientByUrl.keys()].filter(
      (url) => this.endpointByUrl.get(url)?.target !== "shared",
    ).length;
  }

  /** Closes every created endpoint, retaining the first failure after all cleanup runs. */
  closeOnce(): Promise<void> {
    if (this.closePromise !== undefined) return this.closePromise;
    this.state = "closing";
    this.closePromise = this.closeAll();
    return this.closePromise;
  }

  private clientFor(url: string): Client {
    const cached = this.clientByUrl.get(url);
    if (cached !== undefined) return cached;

    const endpoint = this.endpointByUrl.get(url);
    if (endpoint === undefined)
      throw new Error(`No configured ClickHouse endpoint for URL "${url}".`);

    const client = this.clientFactory.create({
      url,
      instance: endpoint.instance,
      cluster: endpoint.cluster,
      maxOpenConnections: this.configuration.poolSizing.size,
    });
    this.clientByUrl.set(url, client);
    return client;
  }

  private async closeAll(): Promise<void> {
    try {
      const results = await Promise.allSettled(
        [...this.clientByUrl.values()].map((client) => client.close()),
      );
      const failure = results.find(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );
      if (failure !== undefined) throw failure.reason;
    } finally {
      this.state = "closed";
    }
  }

  private assertOpen(): void {
    if (this.state !== "open") throw new ClickHouseConnectionClosedError();
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
