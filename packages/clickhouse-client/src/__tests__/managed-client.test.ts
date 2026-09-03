import { describe, expect, it, vi } from "vitest";
import type { ClickHouseClientCreationInput } from "../connection";
import {
  ClickHouseManagedClientService,
  ClickHouseOverloadErrorFactory,
  ClickHouseManagedClientTelemetry,
  ClickHouseVendorClientFactory,
  type ClickHouseVendorClient,
  type ClickHouseVendorClientOptions,
} from "../managed-client";
import { QueueFullError } from "../rateLimit";
import { VendorClientResiliencePolicy } from "../vendorClient";

interface TestVendorClient extends ClickHouseVendorClient {
  query: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

class RecordingVendorFactory extends ClickHouseVendorClientFactory<TestVendorClient> {
  readonly options: ClickHouseVendorClientOptions[] = [];
  readonly clients: TestVendorClient[] = [];

  create(options: ClickHouseVendorClientOptions): TestVendorClient {
    const client = {
      query: vi.fn(async () => ({ ok: true })),
      insert: vi.fn(async () => ({ ok: true })),
      ping: vi.fn(async () => ({ ok: true })),
      close: vi.fn(async () => undefined),
    };
    this.options.push(options);
    this.clients.push(client);
    return client;
  }
}

class PassthroughOverloadErrorFactory extends ClickHouseOverloadErrorFactory {
  create({ cause }: { cause: unknown }): unknown {
    return cause;
  }
}

class RecordingTelemetry extends ClickHouseManagedClientTelemetry {
  readonly registered: string[] = [];
  readonly unregistered: string[] = [];
  readonly waits: string[] = [];
  readonly shed: string[] = [];

  registerLimiter({ instance }: { instance: string }): void {
    this.registered.push(instance);
  }

  unregisterLimiter(instance: string): void {
    this.unregistered.push(instance);
  }

  observeStatementWait({
    instance,
    operation,
  }: {
    instance: string;
    operation: "query" | "insert" | "command" | "exec";
    seconds: number;
  }): void {
    this.waits.push(`${instance}:${operation}`);
  }

  incrementStatementsShed({
    instance,
    operation,
  }: {
    instance: string;
    operation: "query" | "insert" | "command" | "exec";
  }): void {
    this.shed.push(`${instance}:${operation}`);
  }
}

const input: ClickHouseClientCreationInput = {
  url: "http://user:secret@clickhouse.example.test:8123",
  instance: "org-1",
  cluster: "acme",
  maxOpenConnections: 2,
};

describe("ClickHouseManagedClientService", () => {
  it("constructs the driver with explicit transport settings and layers defaults outside limits and retries", async () => {
    const factory = new RecordingVendorFactory();
    const metrics = {
      observeDuration: vi.fn(),
      incrementCount: vi.fn(),
    };
    const service = ClickHouseManagedClientService.create({
      vendorClientFactory: factory,
      defaultQuerySettings: { max_bytes_before_external_group_by: 500_000_000 },
      resilience: VendorClientResiliencePolicy.create({ metrics }),
      telemetry: new RecordingTelemetry(),
      overloadErrorFactory: new PassthroughOverloadErrorFactory(),
    });

    const client = service.create(input);
    await client.query({
      query: "SELECT 1",
      clickhouse_settings: { max_execution_time: 10 },
    });

    expect(factory.options).toEqual([
      {
        url: input.url,
        instance: "org-1",
        cluster: "acme",
        maxOpenConnections: 2,
        requestTimeoutMs: 30_000,
        idleSocketTtlMs: 1_500,
        driverSettings: { date_time_input_format: "best_effort" },
      },
    ]);
    const raw = factory.clients[0];
    if (raw === undefined) throw new Error("Expected a raw vendor client");
    expect(raw.query).toHaveBeenCalledWith({
      query: "SELECT 1",
      clickhouse_settings: {
        max_bytes_before_external_group_by: 500_000_000,
        max_execution_time: 10,
      },
    });
    expect(metrics.incrementCount).toHaveBeenCalledWith({
      queryType: "SELECT",
      outcome: "success",
    });
  });

  it("preserves read retry while holding the limiter slot for the entire operation", async () => {
    const factory = new RecordingVendorFactory();
    const service = ClickHouseManagedClientService.create({
      vendorClientFactory: factory,
      defaultQuerySettings: {},
      resilience: VendorClientResiliencePolicy.create({
        maxRetries: 1,
        baseDelayMs: 0,
        maxDelayMs: 0,
        transientMessageFragments: ["busy"],
      }),
      telemetry: new RecordingTelemetry(),
      overloadErrorFactory: new PassthroughOverloadErrorFactory(),
    });
    const client = service.create(input);
    const raw = factory.clients[0];
    if (raw === undefined) throw new Error("Expected a raw vendor client");
    raw.query.mockRejectedValueOnce(new Error("cluster busy"));

    await expect(client.query({ query: "SELECT 1" })).resolves.toEqual({ ok: true });

    expect(raw.query).toHaveBeenCalledTimes(2);
  });

  it("registers a safe instance label and removes the limiter only after closing the raw client", async () => {
    const factory = new RecordingVendorFactory();
    const ports = new RecordingTelemetry();
    const service = ClickHouseManagedClientService.create({
      vendorClientFactory: factory,
      defaultQuerySettings: {},
      resilience: VendorClientResiliencePolicy.create(),
      telemetry: ports,
      overloadErrorFactory: new PassthroughOverloadErrorFactory(),
    });
    const client = service.create(input);
    await client.query({ query: "SELECT 1" });
    await client.close();

    expect(ports.registered).toEqual(["org-1"]);
    expect(ports.waits).toEqual(["org-1:query"]);
    expect(ports.unregistered).toEqual(["org-1"]);
    const raw = factory.clients[0];
    if (raw === undefined) throw new Error("Expected a raw vendor client");
    expect(raw.close).toHaveBeenCalledOnce();
  });

  it("closes and unregisters at most once even when the vendor close fails", async () => {
    const factory = new RecordingVendorFactory();
    const telemetry = new RecordingTelemetry();
    const service = ClickHouseManagedClientService.create({
      vendorClientFactory: factory,
      defaultQuerySettings: {},
      resilience: VendorClientResiliencePolicy.create(),
      telemetry,
      overloadErrorFactory: new PassthroughOverloadErrorFactory(),
    });
    const client = service.create(input);
    const raw = factory.clients[0];
    if (raw === undefined) throw new Error("Expected a raw vendor client");
    raw.close.mockRejectedValueOnce(new Error("vendor close failed"));

    const first = client.close();
    const second = client.close();

    expect(second).toBe(first);
    await expect(first).rejects.toThrow("vendor close failed");
    expect(raw.close).toHaveBeenCalledOnce();
    expect(telemetry.unregistered).toEqual(["org-1"]);
  });

  it("keeps vendor lifecycle methods bound to their raw client", async () => {
    const factory = new RecordingVendorFactory();
    const service = ClickHouseManagedClientService.create({
      vendorClientFactory: factory,
      defaultQuerySettings: {},
      resilience: VendorClientResiliencePolicy.create(),
      telemetry: new RecordingTelemetry(),
      overloadErrorFactory: new PassthroughOverloadErrorFactory(),
    });
    const client = service.create(input);
    const raw = factory.clients[0];
    if (raw === undefined) throw new Error("Expected a raw vendor client");
    raw.ping = vi.fn(async function (this: ClickHouseVendorClient) {
      if (this !== raw) throw new Error("wrong ping receiver");
    });
    raw.close = vi.fn(async function (this: ClickHouseVendorClient) {
      if (this !== raw) throw new Error("wrong close receiver");
    });

    await client.ping?.();
    await client.close();

    expect(raw.ping).toHaveBeenCalledOnce();
    expect(raw.close).toHaveBeenCalledOnce();
  });

  it("sheds a surplus statement before it reaches the driver and reports only safe labels", async () => {
    const factory = new RecordingVendorFactory();
    const ports = new RecordingTelemetry();
    const service = ClickHouseManagedClientService.create({
      vendorClientFactory: factory,
      defaultQuerySettings: {},
      resilience: VendorClientResiliencePolicy.create(),
      telemetry: ports,
      overloadErrorFactory: new PassthroughOverloadErrorFactory(),
      minimumStatementQueueDepth: 0,
      statementQueueDepthPerSlot: 0,
    });
    const client = service.create({ ...input, maxOpenConnections: 1 });
    const raw = factory.clients[0];
    if (raw === undefined) throw new Error("Expected a raw vendor client");
    let release: (() => void) | undefined;
    raw.query.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ ok: true });
        }),
    );

    const first = client.query({ query: "SELECT 1" });
    await vi.waitFor(() => expect(raw.query).toHaveBeenCalledOnce());
    await expect(client.query({ query: "SELECT 2" })).rejects.toBeInstanceOf(QueueFullError);
    release?.();
    await first;

    expect(raw.query).toHaveBeenCalledOnce();
    expect(ports.shed).toEqual(["org-1:query"]);
  });
});
