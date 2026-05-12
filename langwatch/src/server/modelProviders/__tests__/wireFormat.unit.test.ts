import { describe, expect, it } from "vitest";

import {
  encodeWireValue,
  enumerateWireValuesForModel,
  parseWireValue,
  resolveWireValue,
  type WireMp,
} from "../wireFormat";

const openaiShared: WireMp = {
  id: "mp_openai_shared",
  name: "OpenAI",
  provider: "openai",
};
const openaiProd: WireMp = {
  id: "mp_openai_prod",
  name: "OpenAI",
  provider: "openai",
};
const anthropic: WireMp = {
  id: "mp_anthropic_org",
  name: "Anthropic",
  provider: "anthropic",
};

describe("parseWireValue", () => {
  describe("when the value is mp-id keyed", () => {
    it("returns kind=mp-id with the mpId and model split", () => {
      expect(parseWireValue("mp_abc123/gpt-5")).toEqual({
        kind: "mp-id",
        mpId: "mp_abc123",
        model: "gpt-5",
      });
    });

    it("preserves further slashes in the model portion", () => {
      expect(parseWireValue("mp_abc/vendor/fine-tuned:v1")).toEqual({
        kind: "mp-id",
        mpId: "mp_abc",
        model: "vendor/fine-tuned:v1",
      });
    });
  });

  describe("when the value is legacy provider-keyed", () => {
    it("returns kind=legacy", () => {
      expect(parseWireValue("openai/gpt-5")).toEqual({
        kind: "legacy",
        provider: "openai",
        model: "gpt-5",
      });
    });

    it("treats azure_safety/etc snake_case providers correctly", () => {
      expect(parseWireValue("azure_safety/content-filter")).toEqual({
        kind: "legacy",
        provider: "azure_safety",
        model: "content-filter",
      });
    });
  });

  describe("when the value is malformed", () => {
    it.each(["", "no-slash", "/leading-slash", "trailing-slash/"])(
      "returns kind=unknown for %s",
      (raw) => {
        expect(parseWireValue(raw)).toEqual({ kind: "unknown", raw });
      },
    );
  });
});

describe("encodeWireValue", () => {
  it("joins mpId and model with a single slash", () => {
    expect(encodeWireValue("mp_abc", "gpt-5")).toBe("mp_abc/gpt-5");
  });
});

describe("resolveWireValue", () => {
  describe("when the wire value encodes a specific mpId", () => {
    it("returns the matching MP", () => {
      const result = resolveWireValue("mp_openai_shared/gpt-5", [
        openaiShared,
        openaiProd,
      ]);
      expect(result).toEqual({ ok: true, mp: openaiShared, model: "gpt-5" });
    });

    it("reports not_found when the mpId is unknown", () => {
      const result = resolveWireValue("mp_missing/gpt-5", [openaiShared]);
      expect(result).toEqual({
        ok: false,
        reason: "not_found",
        value: "mp_missing/gpt-5",
        hint: expect.stringContaining("mp_missing"),
      });
    });
  });

  describe("when the wire value is legacy provider-keyed", () => {
    it("resolves unambiguously when exactly one MP matches the provider", () => {
      const result = resolveWireValue("openai/gpt-5", [openaiShared, anthropic]);
      expect(result).toEqual({ ok: true, mp: openaiShared, model: "gpt-5" });
    });

    it("reports not_found when no accessible MP has that provider", () => {
      const result = resolveWireValue("cohere/command-r", [
        openaiShared,
        anthropic,
      ]);
      expect(result).toEqual({
        ok: false,
        reason: "not_found",
        value: "cohere/command-r",
        hint: expect.stringContaining("cohere"),
      });
    });

    it("reports ambiguous when multiple accessible MPs share the provider", () => {
      const result = resolveWireValue("openai/gpt-5", [
        openaiShared,
        openaiProd,
      ]);
      expect(result).toEqual({
        ok: false,
        reason: "ambiguous",
        value: "openai/gpt-5",
        candidates: [openaiShared, openaiProd],
      });
    });
  });

  describe("when the wire value is malformed", () => {
    it("reports not_found with a generic hint", () => {
      const result = resolveWireValue("garbage", [openaiShared]);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("not_found");
      }
    });
  });
});

describe("enumerateWireValuesForModel", () => {
  it("returns one wire value per MP with the matching provider", () => {
    expect(
      enumerateWireValuesForModel("openai", "gpt-5", [
        openaiShared,
        openaiProd,
        anthropic,
      ]),
    ).toEqual(["mp_openai_shared/gpt-5", "mp_openai_prod/gpt-5"]);
  });

  it("returns an empty list when no accessible MP has the provider", () => {
    expect(
      enumerateWireValuesForModel("cohere", "command-r", [openaiShared]),
    ).toEqual([]);
  });
});
