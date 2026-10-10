import { describe, expect, it, vi } from "vitest";

import { ClickHouseConfigService } from "../config.ts";
import {
  ClickHouseClientFactory,
  ClickHouseConnectionClosedError,
  ClickHouseConnectionService,
  ClickHouseNotConfiguredError,
  type ClickHouseClientCreationInput,
  type ClickHouseCloseableClient,
  ClickHouseShutdownService,
} from "../connection.ts";

interface TestClient extends ClickHouseCloseableClient {
  input: ClickHouseClientCreationInput;
}

class RecordingClientFactory extends ClickHouseClientFactory<TestClient> {
  readonly inputs: ClickHouseClientCreationInput[] = [];
  readonly clients: TestClient[] = [];

  create(input: ClickHouseClientCreationInput): TestClient {
    const client = { input, close: vi.fn(async () => undefined) };
    this.inputs.push(input);
    this.clients.push(client);
    return client;
  }
}

const configuration = () =>
  ClickHouseConfigService.create().resolve({
    shared: { url: "http://shared:8123", cluster: "shared" },
    privateRoutes: [
      { organizationId: "org-1", url: "http://private:8123", cluster: "acme" },
      { organizationId: "org-2", url: "http://private:8123", cluster: "acme" },
    ],
    poolSizing: { override: 7 },
  });

describe("routing the three accessors by the id each was given", () => {
  function connect() {
    const factory = new RecordingClientFactory();
    const organizationForTenant = vi.fn(async () => "org-1");
    const connection = ClickHouseConnectionService.create({
      directory: { organizationForTenant },
      clientFactory: factory,
    }).connect(configuration());
    return { connection, factory, organizationForTenant };
  }

  /** @scenario "An organization on its own endpoint is routed there without a tenant lookup" */
  it("reaches the organization's own endpoint and never asks the tenant directory", () => {
    const { connection, organizationForTenant } = connect();

    const client = connection.resolveOrganization("org-1");

    expect(client.input).toMatchObject({ instance: "org-1", cluster: "acme" });
    expect(organizationForTenant).not.toHaveBeenCalled();
  });

  /** @scenario "An organization with no private route reads the shared endpoint" */
  it("answers the shared endpoint for an organization with no route of its own", () => {
    const { connection } = connect();

    expect(connection.resolveOrganization("org-unrouted").input).toMatchObject({
      instance: "shared",
      cluster: "shared",
    });
  });

  /** @scenario "A project is still routed through the tenant directory" */
  it("sends a project through the directory to the endpoint its organization reaches", async () => {
    const { connection, organizationForTenant } = connect();

    const project = await connection.resolve("project-1");

    expect(organizationForTenant).toHaveBeenCalledWith("project-1");
    expect(project).toBe(connection.resolveOrganization("org-1"));
  });

  /** @scenario "The install's own shared endpoint answers the read that is nobody's tenant" */
  it("answers the install's own shared endpoint without a tenant", () => {
    const { connection, organizationForTenant } = connect();

    expect(connection.shared().input).toMatchObject({ instance: "shared", cluster: "shared" });
    expect(organizationForTenant).not.toHaveBeenCalled();
  });

  /** @scenario "The three accessors share one driver per physical endpoint" */
  it("opens one driver per endpoint across the tenant, organization and shared accessors", async () => {
    const { connection, factory } = connect();

    await connection.resolve("project-1");
    connection.resolveOrganization("org-2");
    connection.shared();
    connection.shared();

    expect(factory.inputs.map(({ instance }) => instance)).toEqual(["org-1", "shared"]);
  });

  /** @scenario "An install holding only private routes reports no shared endpoint" */
  it("refuses the shared accessor by name when the install has only private routes", () => {
    const factory = new RecordingClientFactory();
    const connection = ClickHouseConnectionService.create({
      directory: { organizationForTenant: async () => "org-1" },
      clientFactory: factory,
    }).connect(
      ClickHouseConfigService.create().resolve({
        privateRoutes: [{ organizationId: "org-1", url: "http://private:8123", cluster: "acme" }],
      }),
    );

    expect(() => connection.shared()).toThrow(ClickHouseNotConfiguredError);
    expect(factory.inputs).toEqual([]);
  });
});

describe("explicit ClickHouse connection lifecycle", () => {
  /** @scenario Private clients are cached per organization */
  it("constructs an endpoint once and resolves tenants through the injected directory", async () => {
    const factory = new RecordingClientFactory();
    const organizationForTenant = vi.fn(async (tenantId: string) =>
      tenantId === "project-1" ? "org-1" : "org-2",
    );
    const connection = ClickHouseConnectionService.create({
      directory: { organizationForTenant },
      clientFactory: factory,
    }).connect(configuration());

    const first = await connection.resolve("project-1");
    const second = await connection.resolve("project-2");
    const repeated = await connection.resolve("project-1");

    expect(first).toBe(second);
    expect(repeated).toBe(first);
    expect(organizationForTenant).toHaveBeenCalledTimes(2);
    expect(factory.inputs).toEqual([
      {
        url: "http://private:8123",
        instance: "org-1",
        cluster: "acme",
        maxOpenConnections: 7,
      },
    ]);
  });

  /** @scenario getAllClickHouseInstances returns shared and all private instances */
  it("builds each physical endpoint once for migrations and checks", () => {
    const factory = new RecordingClientFactory();
    const connection = ClickHouseConnectionService.create({
      directory: { organizationForTenant: async () => "org-1" },
      clientFactory: factory,
    }).connect(configuration());

    const instances = connection.instances();

    expect(instances.map(({ target }) => target)).toEqual(["shared", "org-1"]);
    expect(factory.inputs).toEqual([
      expect.objectContaining({ instance: "shared", maxOpenConnections: 7 }),
      expect.objectContaining({ instance: "org-1", maxOpenConnections: 7 }),
    ]);
  });

  it("fails closed when a tenant routes to shared ClickHouse but no shared endpoint exists", async () => {
    const factory = new RecordingClientFactory();
    const configurationWithoutShared = ClickHouseConfigService.create().resolve({});
    const connection = ClickHouseConnectionService.create({
      directory: { organizationForTenant: async () => "org-1" },
      clientFactory: factory,
    }).connect(configurationWithoutShared);

    await expect(connection.resolve("project-1")).rejects.toBeInstanceOf(
      ClickHouseNotConfiguredError,
    );
    expect(factory.inputs).toEqual([]);
  });

  it("closes every constructed endpoint once while retaining the first close failure", async () => {
    const factory = new RecordingClientFactory();
    const connection = ClickHouseConnectionService.create({
      directory: { organizationForTenant: async () => "org-1" },
      clientFactory: factory,
    }).connect(configuration());

    connection.instances();
    const first = factory.clients[0];
    const second = factory.clients[1];
    if (first === undefined || second === undefined) throw new Error("Expected two clients");
    vi.mocked(first.close).mockRejectedValueOnce(new Error("shared close failed"));

    await expect(ClickHouseShutdownService.create().shutdown(connection)).rejects.toThrow(
      "shared close failed",
    );
    await expect(ClickHouseShutdownService.create().shutdown(connection)).rejects.toThrow(
      "shared close failed",
    );
    expect(first.close).toHaveBeenCalledOnce();
    expect(second.close).toHaveBeenCalledOnce();
  });

  it("uses stable shared and private aliases for one endpoint", async () => {
    const factory = new RecordingClientFactory();
    const connection = ClickHouseConnectionService.create({
      directory: { organizationForTenant: async () => "org-2" },
      clientFactory: factory,
    }).connect(
      ClickHouseConfigService.create().resolve({
        shared: { url: "http://same:8123", cluster: "shared" },
        privateRoutes: [
          { organizationId: "org-2", url: "http://private:8123", cluster: "later" },
          { organizationId: "org-1", url: "http://private:8123", cluster: "first" },
          { organizationId: "org-3", url: "http://same:8123", cluster: "private-shared" },
        ],
        poolSizing: { override: 4 },
      }),
    );

    const privateClient = await connection.resolve("project-2");
    const sharedClient = connection.resolveOrganization("org-3");
    const instances = connection.instances();

    expect(privateClient.input).toMatchObject({ instance: "org-1", cluster: "first" });
    expect(sharedClient.input).toMatchObject({ instance: "shared", cluster: "shared" });
    expect(instances.map(({ target }) => target)).toEqual(["shared", "org-1"]);
  });

  it("refuses resolves and instance enumeration once closing starts", async () => {
    const factory = new RecordingClientFactory();
    const connection = ClickHouseConnectionService.create({
      directory: { organizationForTenant: async () => "org-1" },
      clientFactory: factory,
    }).connect(configuration());
    const client = await connection.resolve("project-1");
    let releaseClose: (() => void) | undefined;
    vi.mocked(client.close).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseClose = resolve;
        }),
    );

    const closing = connection.closeOnce();

    await expect(connection.resolve("project-1")).rejects.toBeInstanceOf(
      ClickHouseConnectionClosedError,
    );
    expect(() => connection.instances()).toThrow(ClickHouseConnectionClosedError);

    releaseClose?.();
    await closing;
  });

  it("clears only private clients and allows their later recreation", async () => {
    const factory = new RecordingClientFactory();
    const connection = ClickHouseConnectionService.create({
      directory: { organizationForTenant: async () => "org-1" },
      clientFactory: factory,
    }).connect(configuration());
    const shared = connection.shared();
    const privateClient = connection.resolveOrganization("org-1");

    expect(connection.privateClientCount()).toBe(1);
    await connection.clearPrivateClients();

    expect(shared.close).not.toHaveBeenCalled();
    expect(privateClient.close).toHaveBeenCalledOnce();
    expect(connection.privateClientCount()).toBe(0);

    const recreated = connection.resolveOrganization("org-1");
    expect(recreated).not.toBe(privateClient);
    expect(connection.privateClientCount()).toBe(1);
  });
});
