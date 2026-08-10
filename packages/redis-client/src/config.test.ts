import { describe, expect, it } from "vitest";
import {
  isRedisConfigured,
  parseClusterEndpoints,
  parseRedisDbIndex,
  resolveRedisConfig,
} from "./config";

describe("resolveRedisConfig", () => {
  describe("given a cluster endpoint list", () => {
    /** @scenario "Cluster endpoints are parsed into hosts and ports" */
    it("parses each entry into a host and a port", () => {
      const resolution = resolveRedisConfig({
        clusterEndpoints: "one:6379,two:6380",
      });

      expect(resolution).toMatchObject({
        configured: true,
        mode: "cluster",
        endpoints: [
          { host: "one", port: 6379 },
          { host: "two", port: 6380 },
        ],
      });
    });

    /** @scenario "An endpoint without a port defaults to the Redis port" */
    it("defaults a portless entry to 6379", () => {
      expect(parseClusterEndpoints("solo")).toEqual([
        { host: "solo", port: 6379 },
      ]);
    });

    it("accepts entries that carry a scheme", () => {
      expect(parseClusterEndpoints("redis://one:6390")).toEqual([
        { host: "one", port: 6390 },
      ]);
    });

    it("ignores blank entries and surrounding whitespace", () => {
      expect(parseClusterEndpoints(" one:6379 , ,two:6380 ")).toEqual([
        { host: "one", port: 6379 },
        { host: "two", port: 6380 },
      ]);
    });

    describe("when a database index is also set", () => {
      /** @scenario "Cluster mode reports that a database index cannot apply" */
      it("warns and pins the database to 0", () => {
        const resolution = resolveRedisConfig({
          clusterEndpoints: "one:6379",
          dbIndex: "3",
        });

        expect(resolution).toMatchObject({ mode: "cluster", db: 0 });
        expect(resolution.warnings).toHaveLength(1);
        expect(resolution.warnings[0]).toContain("only supports database 0");
      });
    });

    describe("when a plain URL is also set", () => {
      it("targets the cluster", () => {
        const resolution = resolveRedisConfig({
          url: "redis://ignored:6379",
          clusterEndpoints: "one:6379",
        });

        expect(resolution).toMatchObject({ mode: "cluster" });
      });
    });
  });

  describe("given a standalone URL", () => {
    /** @scenario "A database index is honoured in standalone mode" */
    it("applies the database index", () => {
      const resolution = resolveRedisConfig({
        url: "redis://localhost:6379",
        dbIndex: "3",
      });

      expect(resolution).toMatchObject({
        configured: true,
        mode: "standalone",
        url: "redis://localhost:6379",
        db: 3,
      });
      expect(resolution.warnings).toEqual([]);
    });

    /** @scenario "A rediss URL connects over TLS" */
    it("enables TLS for a rediss URL", () => {
      const resolution = resolveRedisConfig({ url: "rediss://host:6379" });

      expect(resolution).toMatchObject({ tls: {} });
    });

    /** @scenario "A URL asking to skip certificate verification is honoured" */
    it("disables certificate verification when the URL asks for it", () => {
      const resolution = resolveRedisConfig({
        url: "rediss://host:6379?tls.rejectUnauthorized=false",
      });

      expect(resolution).toMatchObject({ tls: { rejectUnauthorized: false } });
    });

    /** @scenario "A plain redis URL connects without TLS" */
    it("leaves TLS off for a redis URL", () => {
      const resolution = resolveRedisConfig({ url: "redis://host:6379" });

      expect(resolution).toMatchObject({ tls: void 0 });
    });
  });

  describe("given no Redis configuration", () => {
    /** @scenario "No Redis configuration means no client is asked for" */
    it("reports Redis as unconfigured", () => {
      expect(resolveRedisConfig({})).toMatchObject({
        configured: false,
        reason: "unconfigured",
      });
      expect(isRedisConfigured({})).toBe(false);
    });
  });

  describe("when the caller disables Redis", () => {
    /** @scenario "Redis is skipped when the caller disables it" */
    it("reports Redis as unconfigured even with a URL present", () => {
      const resolution = resolveRedisConfig({
        url: "redis://localhost:6379",
        skip: true,
      });

      expect(resolution).toMatchObject({
        configured: false,
        reason: "disabled",
      });
      expect(isRedisConfigured({ url: "redis://localhost:6379", skip: true })).toBe(
        false,
      );
    });
  });
});

describe("parseRedisDbIndex", () => {
  describe("given a value inside the valid range", () => {
    it("returns it as a number", () => {
      expect(parseRedisDbIndex("0")).toBe(0);
      expect(parseRedisDbIndex("15")).toBe(15);
      expect(parseRedisDbIndex(7)).toBe(7);
    });
  });

  describe("given a value outside the valid range", () => {
    /** @scenario "A database index outside the valid range falls back to zero" */
    it("falls back to 0", () => {
      expect(parseRedisDbIndex("16")).toBe(0);
      expect(parseRedisDbIndex("99")).toBe(0);
      expect(parseRedisDbIndex("-1")).toBe(0);
    });
  });

  describe("given a malformed or absent value", () => {
    it("falls back to 0", () => {
      expect(parseRedisDbIndex(void 0)).toBe(0);
      expect(parseRedisDbIndex("")).toBe(0);
      expect(parseRedisDbIndex("two")).toBe(0);
      expect(parseRedisDbIndex("1.5")).toBe(0);
    });
  });
});
