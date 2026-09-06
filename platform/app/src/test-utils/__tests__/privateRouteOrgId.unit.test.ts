import { describe, expect, it } from "vitest";
import { parseRouteKey } from "~/server/clickhouse/privateRouteKey";
import { privateRouteOrgId } from "../clickhouseTestEndpoints";

/**
 * The organization ids the private-ClickHouse suites route with.
 *
 * Each id goes into a `CLICKHOUSE_URL__<label>__<orgId>` variable name, so the
 * only property that matters is that the parser reads back the id the suite
 * wrote. An id carrying a `__` of its own splits the name in the wrong place,
 * and the suite then fails on a run in which nothing changed.
 */
describe("privateRouteOrgId", () => {
  const PREFIX = "CLICKHOUSE_URL__";
  const RUNS = 20_000;

  describe("when an id is put in an env var name", () => {
    it("reads back whole, over enough ids to catch a rare one", () => {
      for (let run = 0; run < RUNS; run++) {
        const orgId = privateRouteOrgId("test-org");

        expect(
          parseRouteKey({
            key: `${PREFIX}testcustomer__${orgId}`,
            prefix: PREFIX,
          }),
        ).toEqual({ orgId, cluster: "testcustomer" });
      }
    });
  });

  describe("when the id is read on its own", () => {
    it("names the namespace it was asked for", () => {
      expect(privateRouteOrgId("test-org")).toMatch(/^test-org-[0-9a-z]{6}$/);
    });
  });

  describe("when the namespace carries the separator itself", () => {
    it("refuses it, rather than minting an id that reads back short", () => {
      expect(() => privateRouteOrgId("test__org")).toThrow("test__org");
    });
  });
});
