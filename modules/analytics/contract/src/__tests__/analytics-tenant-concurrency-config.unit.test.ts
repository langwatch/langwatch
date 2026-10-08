/**
 * How many analytics panel statements one project may run at once, read from
 * CLICKHOUSE_TENANT_ANALYTICS_CONCURRENCY.
 * @see specs/analytics/clickhouse-memory-safety.feature
 */
import { parseProcessConfig } from "@langwatch/config";
import { describe, expect, it } from "vitest";

import {
  analyticsServerConfig,
  DEFAULT_TENANT_ANALYTICS_CONCURRENCY,
} from "../analytics.config.ts";

function concurrency(environment: Readonly<Record<string, string | undefined>>): number {
  const config = parseProcessConfig({
    owners: [{ name: "analytics", config: analyticsServerConfig }],
    environment,
  });
  return config.analytics.tenantAnalyticsConcurrency;
}

describe("the analytics tenant concurrency", () => {
  describe("when the variable is unset or blank", () => {
    it("uses the default of four", () => {
      expect(DEFAULT_TENANT_ANALYTICS_CONCURRENCY).toBe(4);
      expect(concurrency({})).toBe(DEFAULT_TENANT_ANALYTICS_CONCURRENCY);
      expect(concurrency({ CLICKHOUSE_TENANT_ANALYTICS_CONCURRENCY: "" })).toBe(
        DEFAULT_TENANT_ANALYTICS_CONCURRENCY,
      );
      expect(concurrency({ CLICKHOUSE_TENANT_ANALYTICS_CONCURRENCY: " " })).toBe(
        DEFAULT_TENANT_ANALYTICS_CONCURRENCY,
      );
    });
  });

  describe("when the variable is a positive integer", () => {
    it("uses it", () => {
      expect(concurrency({ CLICKHOUSE_TENANT_ANALYTICS_CONCURRENCY: "8" })).toBe(8);
    });
  });

  describe("when the variable is not a positive integer", () => {
    it("keeps the default instead of refusing to boot", () => {
      for (const raw of ["0", "-1", "2.5", "many"]) {
        expect(concurrency({ CLICKHOUSE_TENANT_ANALYTICS_CONCURRENCY: raw })).toBe(
          DEFAULT_TENANT_ANALYTICS_CONCURRENCY,
        );
      }
    });
  });
});
