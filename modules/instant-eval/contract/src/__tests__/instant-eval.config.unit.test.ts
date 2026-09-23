import { ConfigParseError, parseProcessConfig } from "@langwatch/config";
import { describe, expect, it } from "vitest";

import { instantEvalConfig } from "../instant-eval.config.ts";

const read = (environment: Record<string, string | undefined>) =>
  parseProcessConfig({
    owners: [{ name: "instant-eval", config: instantEvalConfig }],
    environment,
  })["instant-eval"];

describe("instant eval server configuration", () => {
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
});
