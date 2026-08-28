import { beforeEach, describe, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => ({
  reconcileTTL: vi.fn(async () => undefined),
  runMigrations: vi.fn(async () => undefined),
}));

vi.mock("../../server/clickhouse/goose", () => ({ runMigrations: stubs.runMigrations }));
vi.mock("../../server/clickhouse/ttlReconciler", () => ({ reconcileTTL: stubs.reconcileTTL }));

import {
  ClickHouseMigrationTask,
  resolveClickHouseMigrationTaskConfig,
} from "../clickhouseMigrate";

describe("clickhouseMigrate", () => {
  beforeEach(() => {
    stubs.runMigrations.mockClear();
    stubs.reconcileTTL.mockClear();
  });

  it("runs schema work once for each physical private endpoint", async () => {
    await ClickHouseMigrationTask.create({
      config: {
        buildTime: false,
        sharedUrl: "http://shared:8123",
        privateEndpoints: [
          { organizationId: "org-2", url: "http://shared:8123" },
          { organizationId: "org-1", url: "http://private:8123" },
          { organizationId: "org-4", url: "http://private:8123" },
          { organizationId: "org-3", url: "http://other-private:8123" },
        ],
      },
    }).execute();

    expect(stubs.runMigrations).toHaveBeenNthCalledWith(1, {
      connectionUrl: "http://shared:8123",
      verbose: true,
    });
    expect(stubs.reconcileTTL).toHaveBeenNthCalledWith(1, {
      connectionUrl: "http://shared:8123",
      verbose: true,
    });
    expect(stubs.runMigrations).toHaveBeenNthCalledWith(2, {
      connectionUrl: "http://private:8123",
      verbose: true,
    });
    expect(stubs.reconcileTTL).toHaveBeenNthCalledWith(2, {
      connectionUrl: "http://private:8123",
      verbose: true,
    });
    expect(stubs.runMigrations).toHaveBeenNthCalledWith(3, {
      connectionUrl: "http://other-private:8123",
      verbose: true,
    });
    expect(stubs.reconcileTTL).toHaveBeenNthCalledWith(3, {
      connectionUrl: "http://other-private:8123",
      verbose: true,
    });
    expect(stubs.runMigrations).toHaveBeenCalledTimes(3);
    expect(stubs.reconcileTTL).toHaveBeenCalledTimes(3);
  });

  it("does nothing during BUILD_TIME even when endpoints are configured", async () => {
    await ClickHouseMigrationTask.create({
      config: {
        buildTime: true,
        sharedUrl: "http://shared:8123",
        privateEndpoints: [{ organizationId: "org-1", url: "http://private:8123" }],
      },
    }).execute();

    expect(stubs.runMigrations).not.toHaveBeenCalled();
    expect(stubs.reconcileTTL).not.toHaveBeenCalled();
  });

  it("parses task-owned endpoint input without a composed application runtime", () => {
    expect(
      resolveClickHouseMigrationTaskConfig({
        CLICKHOUSE_URL: "http://shared:8123",
        CLICKHOUSE_URL__primary__org_1: "http://private:8123",
      }),
    ).toEqual({
      buildTime: false,
      sharedUrl: "http://shared:8123",
      privateEndpoints: [{ organizationId: "org_1", url: "http://private:8123" }],
    });
  });
});
