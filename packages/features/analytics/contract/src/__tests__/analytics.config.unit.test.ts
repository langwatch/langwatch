import { describe, expect, it } from "vitest";
import { assertAnalyticsServerConfig } from "../analytics.config.ts";

const identity = {
  url: "http://clickhouse.test",
  username: "reader",
  password: "secret",
  database: "langwatch",
  tenantSetting: "tenant",
};

const absent = {
  url: undefined,
  username: undefined,
  password: undefined,
  database: undefined,
  tenantSetting: undefined,
};

describe("analytics server configuration", () => {
  describe("given the SQL workbench is not provisioned", () => {
    /** @scenario "A feature reads its configuration through its own schema" */
    it("accepts the whole identity absent", () => {
      expect(() => assertAnalyticsServerConfig({ langwatchQl: absent })).not.toThrow();
    });
  });

  describe("given the SQL workbench identity is half configured", () => {
    /** @scenario "A cross-field rule refuses a half-configured feature at boot" */
    it("refuses, naming the variables and never a value", () => {
      expect(() =>
        assertAnalyticsServerConfig({ langwatchQl: { ...identity, password: undefined } }),
      ).toThrow(/LWQL_CLICKHOUSE_PASSWORD/);
      expect(() =>
        assertAnalyticsServerConfig({ langwatchQl: { ...identity, password: undefined } }),
      ).not.toThrow(/secret/);
    });
  });

  describe("given the whole identity is configured", () => {
    /** @scenario "A feature reads its configuration through its own schema" */
    it("accepts it", () => {
      expect(() => assertAnalyticsServerConfig({ langwatchQl: identity })).not.toThrow();
    });
  });
});
