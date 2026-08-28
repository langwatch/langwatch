import { describe, expect, it, vi } from "vitest";
import { ClickHouseConfigService } from "../config";
import {
  ClickHouseClientFactory,
  ClickHouseConnectionService,
  ClickHouseNotConfiguredError,
  type ClickHouseClientCreationInput,
  type ClickHouseCloseableClient,
} from "../connection";
import { ClickHouseShutdownService } from "../shutdown";

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

describe("explicit ClickHouse connection lifecycle", () => {
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
});
