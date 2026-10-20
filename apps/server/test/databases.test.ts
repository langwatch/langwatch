import { describe, expect, it } from "vitest";

import { ownDatabases, portsInUse } from "../src/shared/databases.ts";
import { allocatePorts, installedPortBase, PORT_BASE_DEFAULT } from "../src/shared/ports.ts";

const ports = allocatePorts(5560);

describe("which databases an install brings itself", () => {
  describe("when the .env names this machine on the bundled port", () => {
    /** @scenario "A bundled database may be named by any loopback address" */
    it("counts localhost, 127.0.0.1 and ::1 alike as bundled", () => {
      for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
        const env = { REDIS_URL: `redis://${host}:${ports.redis}/0` };

        expect(ownDatabases({ env, ports })).toEqual([]);
      }
    });
  });

  describe("when the .env names another host or another port", () => {
    /** @scenario "A bundled database may be named by any loopback address" */
    it("counts it as their own", () => {
      const env = {
        DATABASE_URL: `postgresql://me@db.internal:${ports.postgres}/langwatch`,
        REDIS_URL: `redis://127.0.0.1:6379/0`,
        CLICKHOUSE_URL: `http://localhost:${ports.clickhouseHttp}/langwatch`,
      };

      expect(ownDatabases({ env, ports })).toEqual(["postgres", "redis"]);
    });
  });
});

describe("the ports install and doctor read the .env against", () => {
  describe("when the install's port base was shifted", () => {
    /** @scenario "Install and doctor read the databases at the install's own ports" */
    it("counts its bundled databases as bundled", () => {
      const shifted = allocatePorts(5570);
      const env = {
        PORT: String(shifted.langwatch),
        DATABASE_URL: `postgresql://langwatch@localhost:${shifted.postgres}/langwatch_db`,
        REDIS_URL: `redis://localhost:${shifted.redis}/0`,
        CLICKHOUSE_URL: `http://localhost:${shifted.clickhouseHttp}/langwatch`,
      };

      expect(ownDatabases({ env, ports: allocatePorts(installedPortBase({ env })) })).toEqual([]);
    });
  });

  describe("when the .env has no PORT", () => {
    /** @scenario "Install and doctor read the databases at the install's own ports" */
    it("falls back to the default base", () => {
      expect(installedPortBase({ env: {} })).toBe(PORT_BASE_DEFAULT);
    });
  });
});

describe("doctor's port table", () => {
  describe("when they brought their own Postgres and ClickHouse", () => {
    /** @scenario "Doctor checks the databases the install uses" */
    it("leaves out the bundled ports of what they brought and keeps the rest", () => {
      const names = portsInUse({ ports, own: ["postgres", "clickhouse"] }).map(({ name }) => name);

      expect(names).not.toContain("postgres");
      expect(names).not.toContain("clickhouseHttp");
      expect(names).not.toContain("clickhouseNative");
      expect(names).not.toContain("base");
      expect(names).toEqual(expect.arrayContaining(["langwatch", "redis", "backend"]));
    });
  });
});
