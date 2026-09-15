/**
 * The lazily-built client for the dedicated read-only ops ClickHouse account.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const clickHouseMocks = vi.hoisted(() => ({
  close: vi.fn(async () => undefined),
  createClient: vi.fn(),
}));

vi.mock("@clickhouse/client", () => ({
  createClient: clickHouseMocks.createClient,
}));

import { OpsClickHouseRuntime } from "../clickhouse.ops-explain.repository.ts";

describe("OpsClickHouseRuntime", () => {
  beforeEach(() => {
    clickHouseMocks.close.mockReset();
    clickHouseMocks.createClient.mockReset();
    clickHouseMocks.createClient.mockReturnValue({ close: clickHouseMocks.close });
  });

  it("returns null when no typed ops endpoint was composed", () => {
    const runtime = OpsClickHouseRuntime.create({ buildTime: false });
    expect(runtime.resolveClient()).toBeNull();
  });

  it("lazily builds, caches, and closes a typed endpoint client", async () => {
    const runtime = OpsClickHouseRuntime.create({
      url: "http://langwatch_ops:secret@ch.example:8123/langwatch",
      buildTime: false,
    });
    const a = runtime.resolveClient();
    const b = runtime.resolveClient();
    expect(a).not.toBeNull();
    expect(b).toBe(a);
    await runtime.close();
    expect(clickHouseMocks.close).toHaveBeenCalledOnce();
    expect(runtime.resolveClient()).toBeNull();
  });

  it("does not materialize a client during BUILD_TIME", async () => {
    const runtime = OpsClickHouseRuntime.create({
      url: "http://langwatch_ops:secret@ch.example:8123/langwatch",
      buildTime: true,
    });
    expect(runtime.resolveClient()).toBeNull();
    await runtime.close();
  });
});
