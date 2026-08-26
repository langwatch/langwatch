import { describe, expect, it } from "vitest";
import {
  encodeModelProviderWireValue,
  enumerateModelProviderWireValues,
  parseModelProviderWireValue,
  resolveModelProviderWireValue,
  type ModelProviderWireTarget,
} from "../src/model-provider-wire-format";

const openaiShared: ModelProviderWireTarget = {
  id: "mp_openai_shared",
  name: "OpenAI",
  provider: "openai",
};
const openaiProd: ModelProviderWireTarget = {
  id: "mp_openai_prod",
  name: "OpenAI",
  provider: "openai",
};
const anthropic: ModelProviderWireTarget = {
  id: "mp_anthropic_org",
  name: "Anthropic",
  provider: "anthropic",
};

describe("Model Provider wire values", () => {
  it("parses MP-id and legacy values without losing a model path", () => {
    expect(parseModelProviderWireValue("mp_abc/vendor/fine-tuned:v1")).toEqual({
      kind: "mp-id",
      mpId: "mp_abc",
      model: "vendor/fine-tuned:v1",
    });
    expect(parseModelProviderWireValue("azure_safety/content-filter")).toEqual({
      kind: "legacy",
      provider: "azure_safety",
      model: "content-filter",
    });
    expect(parseModelProviderWireValue("openai/gpt-5")).toEqual({
      kind: "legacy",
      provider: "openai",
      model: "gpt-5",
    });
  });

  it.each(["", "no-slash", "/leading-slash", "trailing-slash/"])(
    "marks malformed value %s as unknown",
    (raw) => {
      expect(parseModelProviderWireValue(raw)).toEqual({ kind: "unknown", raw });
    },
  );

  it("encodes each explicit provider selection with its id", () => {
    expect(encodeModelProviderWireValue("mp_abc", "gpt-5")).toBe("mp_abc/gpt-5");
    expect(
      enumerateModelProviderWireValues("openai", "gpt-5", [
        openaiShared,
        openaiProd,
        anthropic,
      ]),
    ).toEqual(["mp_openai_shared/gpt-5", "mp_openai_prod/gpt-5"]);
  });

  it("resolves an explicit provider id", () => {
    expect(
      resolveModelProviderWireValue("mp_openai_shared/gpt-5", [openaiShared, openaiProd]),
    ).toEqual({ ok: true, mp: openaiShared, model: "gpt-5" });
  });

  it("retains legacy single-provider routing and reports ambiguity", () => {
    expect(
      resolveModelProviderWireValue("openai/gpt-5", [openaiShared, anthropic]),
    ).toEqual({ ok: true, mp: openaiShared, model: "gpt-5" });
    expect(
      resolveModelProviderWireValue("openai/gpt-5", [openaiShared, openaiProd]),
    ).toEqual({
      ok: false,
      reason: "ambiguous",
      value: "openai/gpt-5",
      candidates: [openaiShared, openaiProd],
    });
  });

  it("reports missing selected and legacy providers", () => {
    expect(resolveModelProviderWireValue("mp_missing/gpt-5", [openaiShared])).toEqual({
      ok: false,
      reason: "not_found",
      value: "mp_missing/gpt-5",
      hint: expect.stringContaining("mp_missing"),
    });
    expect(resolveModelProviderWireValue("cohere/command-r", [openaiShared])).toEqual({
      ok: false,
      reason: "not_found",
      value: "cohere/command-r",
      hint: expect.stringContaining("cohere"),
    });
    expect(resolveModelProviderWireValue("garbage", [openaiShared])).toEqual({
      ok: false,
      reason: "not_found",
      value: "garbage",
      hint: "Unrecognised model reference — re-select a model.",
    });
    expect(
      enumerateModelProviderWireValues("cohere", "command-r", [openaiShared]),
    ).toEqual([]);
  });
});
