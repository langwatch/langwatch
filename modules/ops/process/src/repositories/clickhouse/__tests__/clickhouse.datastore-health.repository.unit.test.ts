/**
 * The checkup's ClickHouse reads: goose status runs against the URL the
 * process was configured with (specs/self-hosting/checkup/checkup.feature).
 */
import { ClickHouseQueryClient, type QueryDriver } from "@langwatch/clickhouse-client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const migrations = vi.hoisted(() => ({ getMigrateStatus: vi.fn() }));

vi.mock("@langwatch/clickhouse-migrations", () => ({
  getMigrateStatus: migrations.getMigrateStatus,
}));

import { ClickHouseClickHouseHealthRepository } from "../clickhouse.datastore-health.repository.ts";

const neverRuns = (): Promise<never> => Promise.reject(new Error("no statement runs here"));
const driver: QueryDriver = { execute: neverRuns, insert: neverRuns, command: neverRuns };
const clickhouse = new ClickHouseQueryClient({ driver });

describe("ClickHouseClickHouseHealthRepository", () => {
  beforeEach(() => {
    migrations.getMigrateStatus.mockReset();
    migrations.getMigrateStatus.mockResolvedValue("OK 00001_init.sql");
  });

  describe("given the process is configured with a ClickHouse URL", () => {
    describe("when the checkup reads the ClickHouse migration status", () => {
      /** @scenario "The ClickHouse migrations row asks goose about the ClickHouse this process uses" */
      it("asks goose for its status on that same ClickHouse", async () => {
        const repository = ClickHouseClickHouseHealthRepository.create({
          clickhouse,
          connectionUrl: "http://default:pw@clickhouse:8123/langwatch",
        });

        await expect(repository.readMigrationStatus()).resolves.toBe("OK 00001_init.sql");
        expect(migrations.getMigrateStatus).toHaveBeenCalledWith({
          connectionUrl: "http://default:pw@clickhouse:8123/langwatch",
        });
      });
    });
  });
});
