import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  StoredObjectOwnerLookupRuntime,
  StoredObjectOwnerInstanceDirectoryPort,
  StoredObjectOwnerLookupTelemetryPort,
  type StoredObjectOwnerLookupSpan,
} from "../index";
import { StoredObjectOwnerLookupUnavailableError } from "@langwatch/stored-object-contract";

const resolveInstances = vi.fn();

class RecordingTelemetry extends StoredObjectOwnerLookupTelemetryPort {
  readonly attributes = new Map<string, string | number | boolean>();
  readonly inputIds: string[] = [];

  async withLookupSpan<Result>(
    input: { id: string },
    operation: (span: StoredObjectOwnerLookupSpan) => Promise<Result>,
  ): Promise<Result> {
    this.inputIds.push(input.id);
    return await operation({
      setAttribute: (name, value) => this.attributes.set(name, value),
    });
  }
}

class TestInstanceDirectory extends StoredObjectOwnerInstanceDirectoryPort {
  async listInstances() {
    return await resolveInstances();
  }
}

function makeMockClient(rows: { project_id: string }[]) {
  return {
    query: vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue(rows),
    }),
  };
}

function makeFailingClient(error: Error) {
  return {
    query: vi.fn().mockRejectedValue(error),
  };
}

function service(telemetry = new RecordingTelemetry()) {
  return {
    service: StoredObjectOwnerLookupRuntime.create({
      instanceDirectory: new TestInstanceDirectory(),
      telemetry,
    }).resolver,
    telemetry,
  };
}

describe("StoredObjectOwnerLookupRuntime", () => {
  beforeEach(() => {
    resolveInstances.mockReset();
  });

  it("finds a stored object owner in the shared ClickHouse instance", async () => {
    resolveInstances.mockResolvedValue([
      {
        target: "shared",
        client: makeMockClient([{ project_id: "proj_a" }]),
      },
    ]);

    const { service: resolver, telemetry } = service();

    await expect(resolver.resolve({ id: "obj-1" })).resolves.toEqual({ projectId: "proj_a" });
    expect(telemetry.inputIds).toEqual(["obj-1"]);
    expect(telemetry.attributes).toEqual(
      new Map<string, string | number | boolean>([
        ["clickhouse.instances_searched", 1],
        ["clickhouse.instances_failed", 0],
        ["result.found", true],
        ["result.matched_instance", "shared"],
      ]),
    );
  });

  it("finds a private ClickHouse owner after the shared instance misses", async () => {
    resolveInstances.mockResolvedValue([
      { target: "shared", client: makeMockClient([]) },
      {
        target: "org_byoc",
        client: makeMockClient([{ project_id: "proj_byoc" }]),
      },
    ]);

    const { service: resolver } = service();

    await expect(resolver.resolve({ id: "obj-byoc" })).resolves.toEqual({ projectId: "proj_byoc" });
  });

  it("returns null after every healthy instance misses", async () => {
    const shared = makeMockClient([]);
    const privateClient = makeMockClient([]);
    resolveInstances.mockResolvedValue([
      { target: "shared", client: shared },
      { target: "org_byoc", client: privateClient },
    ]);

    const { service: resolver } = service();

    await expect(resolver.resolve({ id: "unknown" })).resolves.toBeNull();
    expect(shared.query).toHaveBeenCalledTimes(1);
    expect(privateClient.query).toHaveBeenCalledTimes(1);
  });

  it("returns a healthy match when another ClickHouse instance fails", async () => {
    resolveInstances.mockResolvedValue([
      { target: "org_byoc_down", client: makeFailingClient(new Error("connection refused")) },
      {
        target: "shared",
        client: makeMockClient([{ project_id: "proj_shared" }]),
      },
    ]);

    const { service: resolver, telemetry } = service();

    await expect(resolver.resolve({ id: "obj-x" })).resolves.toEqual({ projectId: "proj_shared" });
    expect(telemetry.attributes.get("clickhouse.instances_failed")).toBe(1);
    expect(telemetry.attributes.get("result.degraded")).toBeUndefined();
  });

  it("throws a retryable degraded error when no healthy instance finds an owner", async () => {
    resolveInstances.mockResolvedValue([
      { target: "shared", client: makeMockClient([]) },
      { target: "org_byoc_down", client: makeFailingClient(new Error("timeout")) },
    ]);

    const { service: resolver, telemetry } = service();

    await expect(resolver.resolve({ id: "obj-x" })).rejects.toMatchObject({
      failedTargets: ["org_byoc_down"],
    });
    expect(telemetry.attributes.get("result.degraded")).toBe(true);
  });

  it("retains the unavailable-error type for transport 502 mapping", async () => {
    resolveInstances.mockResolvedValue([
      { target: "shared", client: makeMockClient([]) },
      { target: "org_byoc_down", client: makeFailingClient(new Error("timeout")) },
    ]);

    const { service: resolver } = service();

    await expect(resolver.resolve({ id: "obj-x" })).rejects.toBeInstanceOf(
      StoredObjectOwnerLookupUnavailableError,
    );
  });

  it("fails descriptively when no ClickHouse instance is configured", async () => {
    resolveInstances.mockResolvedValue([]);

    const { service: resolver } = service();

    await expect(resolver.resolve({ id: "obj-1" })).rejects.toThrow(/ClickHouse is not configured/);
  });
});
