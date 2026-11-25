import { describe, expect, it } from "vitest";

import { redisStatementSerializer, selectInstrumentations } from "../node-instrumentations.ts";

describe("selectInstrumentations", () => {
  describe("when neither variable is set", () => {
    it("patches aws-sdk and openai, leaving ioredis off", () => {
      expect(selectInstrumentations({ enabled: undefined, disabled: undefined })).toEqual({
        names: ["aws-sdk", "openai"],
        unknown: [],
      });
    });
  });

  describe("when OTEL_NODE_ENABLED_INSTRUMENTATIONS is set", () => {
    it("patches exactly the listed instrumentations", () => {
      expect(
        selectInstrumentations({ enabled: " openai , ioredis ", disabled: undefined }).names,
      ).toEqual(["openai", "ioredis"]);
    });
  });

  describe("when OTEL_NODE_DISABLED_INSTRUMENTATIONS is set", () => {
    it("removes the listed instrumentations from the defaults", () => {
      expect(selectInstrumentations({ enabled: undefined, disabled: "aws-sdk" }).names).toEqual([
        "openai",
      ]);
    });

    it("removes them from an explicit enabled list too", () => {
      expect(
        selectInstrumentations({ enabled: "openai,ioredis", disabled: "openai" }).names,
      ).toEqual(["ioredis"]);
    });

    it("can turn every patch off", () => {
      expect(
        selectInstrumentations({ enabled: undefined, disabled: "aws-sdk,openai" }).names,
      ).toEqual([]);
    });
  });

  describe("when a name is not known", () => {
    it("ignores it and reports it", () => {
      expect(selectInstrumentations({ enabled: "openai,pg", disabled: "express" })).toEqual({
        names: ["openai"],
        unknown: ["pg", "express"],
      });
    });
  });
});

describe("redisStatementSerializer", () => {
  it("records the command and key, never the values", () => {
    expect(redisStatementSerializer("set", ["session:1", "secret-value"])).toBe("set session:1");
  });

  it("truncates an oversized key to 256 characters", () => {
    expect(redisStatementSerializer("get", ["k".repeat(400)])).toHaveLength(256);
  });
});
