/** The deploy task's own admin connection waits out a server with every query slot taken. */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ClickHouseLangWatchQLProvisioningRepository } from "../clickhouse.langwatch-ql-provisioning.repository.ts";

const { vendor } = vi.hoisted(() => ({
  vendor: { command: vi.fn(), query: vi.fn(), insert: vi.fn(), close: vi.fn() },
}));
vi.mock("@clickhouse/client", () => ({ createClient: () => vendor }));

const busy = () =>
  Object.assign(new Error("Too many simultaneous queries. Maximum: 50."), {
    code: "202",
    type: "TOO_MANY_SIMULTANEOUS_QUERIES",
  });

const open = () =>
  ClickHouseLangWatchQLProvisioningRepository.open({
    url: "http://clickhouse:8123/langwatch",
    retry: { sleep: () => Promise.resolve(), random: () => 0 },
  });

describe("ClickHouseLangWatchQLProvisioningRepository.open", () => {
  beforeEach(() => {
    vendor.command.mockReset();
    vendor.query.mockReset();
  });

  describe("given a server that refuses a provisioning statement for want of a slot", () => {
    /** @scenario "LangWatchQL provisioning waits out a ClickHouse with every query slot taken" */
    it("retries the statement and runs the rest once a slot frees", async () => {
      vendor.command
        .mockRejectedValueOnce(busy())
        .mockRejectedValueOnce(busy())
        .mockResolvedValue(undefined);

      const result = await open().runStatements({
        statements: [
          "CREATE DATABASE IF NOT EXISTS langwatch",
          "CREATE TABLE IF NOT EXISTS langwatch.t (a UInt8) ENGINE = Memory",
        ],
      });

      expect(result.skipped).toEqual([]);
      expect(vendor.command).toHaveBeenCalledTimes(4);
    });
  });

  describe("given a server that refuses a read for want of a slot", () => {
    /** @scenario "LangWatchQL provisioning waits out a ClickHouse with every query slot taken" */
    it("retries the read", async () => {
      vendor.query
        .mockRejectedValueOnce(busy())
        .mockResolvedValue({ json: () => Promise.resolve([]) });

      await open().readInventory({ database: "langwatch", relations: [], functions: [] });

      expect(vendor.query.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("given a statement the server will never accept", () => {
    it("fails it on the first attempt", async () => {
      vendor.command.mockRejectedValue(
        Object.assign(new Error("Syntax error"), { code: "62", type: "SYNTAX_ERROR" }),
      );

      await expect(open().runStatements({ statements: ["CREATE NONSENSE"] })).rejects.toMatchObject(
        { code: "62" },
      );
      expect(vendor.command).toHaveBeenCalledTimes(1);
    });
  });
});
