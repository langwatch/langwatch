import { describe, expect, it } from "vitest";
import { allocatePorts, portsToCheck, PORT_BASE_DEFAULT } from "../src/shared/ports.ts";

describe("port allocation", () => {
  describe("when called with the default base", () => {
    it("places langwatch on 5560 and the rest in +1..+7 slots", () => {
      const a = allocatePorts(PORT_BASE_DEFAULT);
      expect(a).toEqual({
        base: 5560,
        langwatch: 5560,
        nlp: 5561,
        langevals: 5562,
        aigateway: 5563,
        redis: 5564,
        clickhouseHttp: 5565,
        clickhouseNative: 5566,
        postgres: 5567,
      });
    });
  });

  describe("when called with a shifted base", () => {
    it("cascades the shift to every service", () => {
      const a = allocatePorts(5570);
      expect(a.langwatch).toBe(5570);
      expect(a.postgres).toBe(5577);
      expect(a.redis).toBe(5574);
    });
  });

  describe("portsToCheck", () => {
    it("returns one entry per service so every slot is detected", () => {
      const a = allocatePorts(5560);
      const checks = portsToCheck(a);
      expect(checks.map((c) => c.label)).toEqual([
        "langwatch",
        "langwatch_nlp",
        "langevals",
        "ai gateway",
        "redis",
        "clickhouse http",
        "clickhouse native",
        "postgres",
      ]);
      expect(new Set(checks.map((c) => c.port)).size).toBe(8);
    });
  });
});
