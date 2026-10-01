import type { ClickHouseClient } from "@clickhouse/client";
import { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { describe, expect, it, vi } from "vitest";

import { clickHouseClientDouble, clickHouseQueryClientDouble } from "../clickhouse.double.ts";

const request = { tenantId: "project-1", sql: "SELECT 1 WHERE TenantId = {tenantId:String}" };

describe("given a ClickHouseQueryClient double", () => {
  describe("when the code runs a scripted statement", () => {
    /** @scenario "A scripted member answers what the test scripted" */
    it("answers the scripted rows and records the request", async () => {
      const query = vi.fn(async () => ({ rows: [{ total: 3 }] }));
      const client = clickHouseQueryClientDouble({ query });

      await expect(client.query<{ total: number }>(request)).resolves.toEqual({
        rows: [{ total: 3 }],
      });
      expect(query).toHaveBeenCalledWith(request);
    });
  });

  describe("when the code runs a statement kind nobody scripted", () => {
    /** @scenario "An unscripted method throws naming its path" */
    it("throws naming the method", () => {
      const client = clickHouseQueryClientDouble({ query: async () => ({ rows: [] }) });

      expect(() => client.command(request)).toThrow("clickhouse.command is not scripted");
    });
  });

  describe("when it is handed to code that wants the client", () => {
    /** @scenario "A client double typechecks as the real client" */
    it("is a ClickHouseQueryClient without a cast", () => {
      const client: ClickHouseQueryClient = clickHouseQueryClientDouble();

      expect(client).toBeInstanceOf(ClickHouseQueryClient);
    });
  });
});

describe("given a vendor ClickHouseClient double", () => {
  describe("when the code queries through a scripted result set", () => {
    /** @scenario "A scripted member answers what the test scripted" */
    it("answers the scripted result set", async () => {
      const query = vi.fn(async () => ({ json: async () => [{ total: 3 }] }));
      const client = clickHouseClientDouble({ query });

      const result = await client.query({ query: "SELECT 1", format: "JSONEachRow" });

      await expect(result.json()).resolves.toEqual([{ total: 3 }]);
    });
  });

  describe("when the code inserts and nobody scripted insert", () => {
    /** @scenario "An unscripted method throws naming its path" */
    it("throws naming the method", () => {
      const client = clickHouseClientDouble();

      expect(() => client.insert({ table: "traces", values: [] })).toThrow(
        "clickhouse.insert is not scripted",
      );
    });
  });

  describe("when it is handed to code that wants the vendor client", () => {
    /** @scenario "A client double typechecks as the real client" */
    it("is a ClickHouseClient without a cast", () => {
      const client: ClickHouseClient = clickHouseClientDouble();

      expect(client.constructor.name).toBe("ClickHouseClient");
    });
  });
});
