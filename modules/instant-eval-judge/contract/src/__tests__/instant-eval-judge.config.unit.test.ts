import { ConfigParseError, parseProcessConfig } from "@langwatch/config";
import { describe, expect, it } from "vitest";

import { instantEvalJudgeConfig } from "../instant-eval-judge.config.ts";

const read = (environment: Record<string, string | undefined>) =>
  parseProcessConfig({
    owners: [{ name: "instant-eval-judge", config: instantEvalJudgeConfig }],
    environment,
  })["instant-eval-judge"];

describe("instant eval judge server configuration", () => {
  describe("given a deployment names no judge origin", () => {
    it("boots without one", () => {
      expect(read({}).classifierBaseUrl).toBeUndefined();
    });
  });

  describe("given a deployment names an https judge origin", () => {
    it("carries it", () => {
      expect(read({ JEV_BASE_URL: "https://judge.example.com" }).classifierBaseUrl).toBe(
        "https://judge.example.com",
      );
    });
  });

  describe("given a deployment names a plaintext judge origin", () => {
    it("refuses to boot, because the judge key would travel in clear", () => {
      expect(() => read({ JEV_BASE_URL: "http://judge.example.com" })).toThrow(ConfigParseError);
      expect(() => read({ JEV_BASE_URL: "http://judge.example.com" })).toThrow(/JEV_BASE_URL/);
    });
  });

  describe("given a deployment that sets no rate", () => {
    it("takes the shipped deployment and project rates", () => {
      const config = read({});
      expect(config.globalTokensPerSecond).toBe(300_000);
      expect(config.tenantTokensPerSecond).toBe(150_000);
    });
  });
});
