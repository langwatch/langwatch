import type { ClickHouseClient } from "@clickhouse/client";
import {
  ClickHouseConfigService,
  ClickHouseConnectionService,
  ClickHouseNotConfiguredError,
  ClickHouseShutdownService,
  type ClickHouseConnection,
  type PoolSizingInput,
  type TenantDirectory,
} from "@langwatch/clickhouse-client";
import { platformManagedClickHouseClientFactory } from "./managedClient";

export type ClickHouseClientResolver = (tenantId: string) => Promise<ClickHouseClient>;

export type AppClickHouseRuntimeOptions = {
  sharedUrl?: string;
  privateRoutes: ReadonlyArray<{ organizationId: string; url: string; cluster: string }>;
  poolSizing: PoolSizingInput;
  directory: TenantDirectory;
  buildTime: boolean;
};

/** One typed ClickHouse graph owned by application composition. */
export class AppClickHouseRuntime {
  static create(options: AppClickHouseRuntimeOptions): AppClickHouseRuntime {
    const connection = ClickHouseConnectionService.create({
      directory: options.directory,
      clientFactory: platformManagedClickHouseClientFactory,
    }).connect(
      ClickHouseConfigService.create().resolve({
        ...(options.sharedUrl === undefined
          ? {}
          : { shared: { url: options.sharedUrl, cluster: "shared" } }),
        privateRoutes: options.privateRoutes,
        poolSizing: options.poolSizing,
      }),
    );
    return new AppClickHouseRuntime(connection, options.privateRoutes, options.buildTime);
  }

  private constructor(
    private readonly connection: ClickHouseConnection<ClickHouseClient>,
    private readonly privateRoutes: ReadonlyArray<{ organizationId: string; url: string }>,
    private readonly buildTime: boolean,
  ) {}

  enabled(): boolean {
    return !this.buildTime && (this.privateRoutes.length > 0 || this.sharedClient() !== null);
  }

  resolveTenant(tenantId: string): Promise<ClickHouseClient> {
    this.assertRuntimeActive();
    return this.connection.resolve(tenantId);
  }

  resolveOrganization(organizationId: string): ClickHouseClient {
    this.assertRuntimeActive();
    try {
      return this.connection.resolveOrganization(organizationId);
    } catch (error) {
      if (error instanceof ClickHouseNotConfiguredError) {
        throw new Error(
          "ClickHouse is not configured. Set the CLICKHOUSE_URL environment variable.",
        );
      }
      throw error;
    }
  }

  instances(): readonly { target: "shared" | string; client: ClickHouseClient }[] {
    if (this.buildTime) return [];
    return this.connection.instances();
  }

  privateUrls(): ReadonlyMap<string, string> {
    return new Map(this.privateRoutes.map((route) => [route.organizationId, route.url]));
  }

  sharedClient(): ClickHouseClient | null {
    if (this.buildTime) return null;
    try {
      return this.connection.shared();
    } catch (error) {
      if (error instanceof ClickHouseNotConfiguredError) return null;
      throw error;
    }
  }

  close(): Promise<void> {
    return ClickHouseShutdownService.create().shutdown(this.connection);
  }

  /** Compatibility lifecycle: clear private clients without ending this process runtime. */
  clearPrivateClientCache(): Promise<void> {
    this.assertRuntimeActive();
    return this.connection.clearPrivateClients();
  }

  privateClientCacheSize(): number {
    if (this.buildTime) return 0;
    return this.connection.privateClientCount();
  }

  invalidateTenantOrganizationCache(): void {
    this.assertRuntimeActive();
    this.connection.invalidateTenantCache();
  }

  private assertRuntimeActive(): void {
    if (this.buildTime) {
      throw new Error("ClickHouse clients are unavailable while BUILD_TIME is set.");
    }
  }
}

let configuredRuntime: AppClickHouseRuntime | undefined;

/** Transitional compatibility façade for legacy callers; composition installs it once. */
export function configureClickHouseRuntime(runtime: AppClickHouseRuntime): void {
  if (configuredRuntime !== undefined && configuredRuntime !== runtime) {
    throw new Error("ClickHouse runtime is already configured for this process.");
  }
  configuredRuntime = runtime;
}

/** Drains one composed runtime and releases only that runtime's compatibility binding. */
export function shutdownComposedClickHouseRuntime(runtime: AppClickHouseRuntime): Promise<void> {
  return runtime.close().then(
    () => releaseClickHouseRuntime(runtime),
    (error: unknown) => {
      releaseClickHouseRuntime(runtime);
      throw error;
    },
  );
}

function releaseClickHouseRuntime(runtime: AppClickHouseRuntime): void {
  if (configuredRuntime === runtime) configuredRuntime = undefined;
}

function runtime(): AppClickHouseRuntime {
  if (configuredRuntime === undefined) throw new Error("ClickHouse runtime has not been composed.");
  return configuredRuntime;
}

export const getClickHouseClientForTenant = (tenantId: string) => runtime().resolveTenant(tenantId);
export const getClickHouseClientForOrganization = async (organizationId: string) =>
  runtime().resolveOrganization(organizationId);
export const getAllClickHouseInstances = async () => [...runtime().instances()];
export const isClickHouseEnabled = () => runtime().enabled();
export const shutdownClickHouseConnections = () => shutdownComposedClickHouseRuntime(runtime());
export const getPrivateClickHouseUrls = () => runtime().privateUrls();
export const _getSharedClickHouseClient = () => runtime().sharedClient();
export const clearTenantOrgCache = () => runtime().invalidateTenantOrganizationCache();
export const getCustomClientCacheSize = () => runtime().privateClientCacheSize();
export const clearCustomClientCache = () => runtime().clearPrivateClientCache();
