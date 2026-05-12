import { describe, expect, it } from "vitest";
import { servicePaths } from "../../src/services/paths.ts";

const fakePaths = {
  root: "/tmp/.langwatch-test",
  bin: "/tmp/.langwatch-test/bin",
  data: "/tmp/.langwatch-test/data",
  redisData: "/tmp/.langwatch-test/data/redis",
  postgresData: "/tmp/.langwatch-test/data/postgres",
  clickhouseData: "/tmp/.langwatch-test/data/clickhouse",
  logs: "/tmp/.langwatch-test/logs",
  pidFile: "/tmp/.langwatch-test/run/langwatch.pid",
  lockFile: "/tmp/.langwatch-test/run/langwatch.lock",
  envFile: "/tmp/.langwatch-test/.env",
  installManifest: "/tmp/.langwatch-test/install-manifest.json",
} as const;

describe("servicePaths", () => {
  describe("when deriving log paths", () => {
    it("returns one log file per service under <root>/logs", () => {
      const sp = servicePaths(fakePaths);
      expect(sp.log("postgres")).toBe("/tmp/.langwatch-test/logs/postgres.log");
      expect(sp.log("langwatch")).toBe("/tmp/.langwatch-test/logs/langwatch.log");
      expect(sp.log("aigateway")).toBe("/tmp/.langwatch-test/logs/aigateway.log");
    });
  });

  describe("when deriving pid paths", () => {
    it("returns one pidfile per service under <root>/run", () => {
      const sp = servicePaths(fakePaths);
      expect(sp.pid("postgres")).toBe("/tmp/.langwatch-test/run/postgres.pid");
      expect(sp.pid("redis")).toBe("/tmp/.langwatch-test/run/redis.pid");
    });
  });

  describe("when deriving venv paths", () => {
    it("returns one venv per python service under <root>/venvs", () => {
      const sp = servicePaths(fakePaths);
      expect(sp.venv("langwatch_nlp")).toBe("/tmp/.langwatch-test/venvs/langwatch_nlp");
      expect(sp.venv("langevals")).toBe("/tmp/.langwatch-test/venvs/langevals");
    });
  });

  describe("when reading the redis conf path", () => {
    it("places it under data/redis so a data-dir wipe takes the conf with it", () => {
      const sp = servicePaths(fakePaths);
      expect(sp.redisConf).toBe("/tmp/.langwatch-test/data/redis/redis.conf");
    });
  });
});
