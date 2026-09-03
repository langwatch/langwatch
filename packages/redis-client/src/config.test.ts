import { describe, expect, it } from "vitest";
import { RedisConfigService } from "./config";

const config = new RedisConfigService();

describe("RedisConfigService", () => {
  describe("given a cluster endpoint list", () => {
    /** @scenario "Cluster endpoints are parsed into hosts and ports" */
    it("parses each entry into a host and a port", () => {
      const resolution = config.resolve({
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
      expect(config.resolve({ clusterEndpoints: "solo" })).toMatchObject({
        endpoints: [{ host: "solo", port: 6379 }],
      });
    });

    it("accepts entries that carry a scheme", () => {
      expect(config.resolve({ clusterEndpoints: "redis://one:6390" })).toMatchObject({
        endpoints: [{ host: "one", port: 6390 }],
      });
    });

    it("ignores blank entries and surrounding whitespace", () => {
      expect(config.resolve({ clusterEndpoints: " one:6379 , ,two:6380 " })).toMatchObject({
        endpoints: [
          { host: "one", port: 6379 },
          { host: "two", port: 6380 },
        ],
      });
    });

    describe("when a database index is also set", () => {
      /** @scenario "Cluster mode reports that a database index cannot apply" */
      it("warns and pins the database to 0", () => {
        const resolution = config.resolve({
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
        const resolution = config.resolve({
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
      const resolution = config.resolve({
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

    it("accepts the highest valid database index", () => {
      expect(config.resolve({ url: "redis://localhost:6379", dbIndex: 15 })).toMatchObject({
        db: 15,
      });
    });

    /** @scenario "A database index outside the valid range falls back to zero" */
    it("falls back to database 0 for an out-of-range index", () => {
      for (const dbIndex of ["16", "99", "-1"]) {
        expect(config.resolve({ url: "redis://localhost:6379", dbIndex })).toMatchObject({
          db: 0,
        });
      }
    });

    it("falls back to database 0 for a malformed or absent index", () => {
      for (const dbIndex of [void 0, "", "two", "1.5"]) {
        expect(config.resolve({ url: "redis://localhost:6379", dbIndex })).toMatchObject({
          db: 0,
        });
      }
    });

    /** @scenario "A rediss URL connects over TLS" */
    it("enables TLS for a rediss URL", () => {
      const resolution = config.resolve({ url: "rediss://host:6379" });

      expect(resolution).toMatchObject({ tls: {} });
    });

    /** @scenario "A URL asking to skip certificate verification is honoured" */
    it("disables certificate verification when the URL asks for it", () => {
      const resolution = config.resolve({
        url: "rediss://host:6379?tls.rejectUnauthorized=false",
      });

      expect(resolution).toMatchObject({ tls: { rejectUnauthorized: false } });
    });

    /** @scenario "A plain redis URL connects without TLS" */
    it("leaves TLS off for a redis URL", () => {
      const resolution = config.resolve({ url: "redis://host:6379" });

      expect(resolution).toMatchObject({ tls: void 0 });
    });
  });

  describe("given no Redis configuration", () => {
    /** @scenario "No Redis configuration means no client is asked for" */
    it("reports Redis as unconfigured", () => {
      expect(config.resolve({})).toMatchObject({
        configured: false,
        reason: "unconfigured",
      });
      expect(config.isConfigured({})).toBe(false);
    });
  });

  describe("when the caller disables Redis", () => {
    /** @scenario "Redis is skipped when the caller disables it" */
    it("reports Redis as unconfigured even with a URL present", () => {
      const env = { url: "redis://localhost:6379", skip: true };

      expect(config.resolve(env)).toMatchObject({
        configured: false,
        reason: "disabled",
      });
      expect(config.isConfigured(env)).toBe(false);
    });
  });

  describe("when Redis is configured", () => {
    it("reports it as configured for either mode", () => {
      expect(config.isConfigured({ url: "redis://localhost:6379" })).toBe(true);
      expect(config.isConfigured({ clusterEndpoints: "one:6379" })).toBe(true);
    });
  });
});
