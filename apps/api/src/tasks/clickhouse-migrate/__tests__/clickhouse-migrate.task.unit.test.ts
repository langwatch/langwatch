import { beforeEach, describe, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => ({
  reconcileTTL: vi.fn(async () => undefined),
  runMigrations: vi.fn(async () => undefined),
}));

vi.mock("../goose.migration-runner", () => ({ runMigrations: stubs.runMigrations }));
vi.mock("../ttl.reconciler", () => ({ reconcileTTL: stubs.reconcileTTL }));

import {
  ClickHouseMigrationTask,
  resolveClickHouseMigrationTaskConfig,
  runClickHouseMigrationTask,
} from "../clickhouse-migrate.task";

describe("clickhouse-migrate task", () => {
  beforeEach(() => {
    stubs.runMigrations.mockClear();
    stubs.reconcileTTL.mockClear();
  });

  it("runs schema work once for each physical private endpoint", async () => {
    await ClickHouseMigrationTask.create({
      config: {
        buildTime: false,
        skipped: false,
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
        skipped: false,
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
      skipped: false,
      sharedUrl: "http://shared:8123",
      privateEndpoints: [{ organizationId: "org_1", url: "http://private:8123" }],
    });
  });

  describe("when the operator opted out", () => {
    it("runs nothing for SKIP_CLICKHOUSE_MIGRATE=true", async () => {
      await runClickHouseMigrationTask({
        CLICKHOUSE_URL: "http://shared:8123",
        SKIP_CLICKHOUSE_MIGRATE: "true",
      });

      expect(stubs.runMigrations).not.toHaveBeenCalled();
    });

    it("still migrates for a half-recognised value", async () => {
      await runClickHouseMigrationTask({
        CLICKHOUSE_URL: "http://shared:8123",
        SKIP_CLICKHOUSE_MIGRATE: "1",
      });

      expect(stubs.runMigrations).toHaveBeenCalledTimes(1);
    });
  });

  describe("when two variables name one organization", () => {
    it("refuses rather than migrating whichever it read last", () => {
      expect(() =>
        resolveClickHouseMigrationTaskConfig({
          CLICKHOUSE_URL__primary__org_1: "http://one:8123",
          CLICKHOUSE_URL__standby__org_1: "http://two:8123",
        }),
      ).toThrow(/org_1/);
    });
  });

  describe("when the whole environment is the input", () => {
    it("migrates the shared endpoint the environment named", async () => {
      await runClickHouseMigrationTask({ CLICKHOUSE_URL: "http://shared:8123" });

      expect(stubs.runMigrations).toHaveBeenCalledExactlyOnceWith({
        connectionUrl: "http://shared:8123",
        verbose: true,
      });
      expect(stubs.reconcileTTL).toHaveBeenCalledExactlyOnceWith({
        connectionUrl: "http://shared:8123",
        verbose: true,
      });
    });

    it("runs nothing when no endpoint is configured at all", async () => {
      await runClickHouseMigrationTask({});

      expect(stubs.runMigrations).not.toHaveBeenCalled();
      expect(stubs.reconcileTTL).not.toHaveBeenCalled();
    });
  });
});
