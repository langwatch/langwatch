import { describe, expect, it } from "vitest";

import { ClickHouseQueryClient } from "../client.ts";
import type { QueryDriver } from "../query.ts";

const neverRuns = (): Promise<never> => Promise.reject(new Error("no statement runs here"));
const driver: QueryDriver = { execute: neverRuns, insert: neverRuns, command: neverRuns };

describe("ClickHouseQueryClient.privateRoutes()", () => {
  describe("given the routing table the member parsed at boot", () => {
    it("answers each private organization with its endpoint", () => {
      const routes = new Map([["org_private", "http://private.clickhouse:8123"]]);
      const client = new ClickHouseQueryClient({ driver, privateRoutes: routes });

      expect([...client.privateRoutes()]).toEqual([
        ["org_private", "http://private.clickhouse:8123"],
      ]);
    });
  });

  describe("given a deployment with no private routes", () => {
    it("answers an empty table, not a refusal", () => {
      expect(new ClickHouseQueryClient({ driver }).privateRoutes().size).toBe(0);
    });
  });
});
