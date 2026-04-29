import { describe, expect, it } from "vitest";
import { allocatePorts, portsToCheck, PORT_BASE_DEFAULT } from "../src/shared/ports.ts";

describe("port allocation", () => {
  describe("when called with the default base", () => {
    it("splits into app (base..base+9) and infra (base+1000..base+1009) tiers", () => {
      const a = allocatePorts(PORT_BASE_DEFAULT);
      expect(a).toEqual({
        base: 5560,
        langwatch: 5560,
        nlp: 5561,
        langevals: 5562,
        aigateway: 5563,
        postgres: 6560,
        redis: 6561,
        clickhouseHttp: 6562,
        clickhouseNative: 6563,
        bullboard: 6564,
      });
    });
  });

  describe("when called with a shifted base", () => {
    it("cascades the shift to BOTH tiers in lockstep", () => {
      const a = allocatePorts(5570);
      expect(a.langwatch).toBe(5570);
      expect(a.postgres).toBe(6570);
      expect(a.redis).toBe(6571);
      expect(a.bullboard).toBe(6574);
    });
  });

  describe("portsToCheck", () => {
    it("returns one entry per always-on service (bullboard is opt-in)", () => {
      const a = allocatePorts(5560);
      const checks = portsToCheck(a);
      expect(checks.map((c) => c.label)).toEqual([
        "langwatch",
        "nlpgo",
        "langevals",
        "ai gateway",
        "postgres",
        "redis",
        "clickhouse http",
        "clickhouse native",
      ]);
      expect(new Set(checks.map((c) => c.port)).size).toBe(8);
    });
  });
});
