import type { LLMModelEntry, LLMModelPricing } from "@langwatch/model-provider-contract";
import { describe, expect, it } from "vitest";
import {
  auditCatalog,
  blockingFindings,
  findUnpricedModels,
  isPricedElsewhere,
  pricedUnits,
  renderAuditMarkdown,
  type AuditBaseline,
} from "../catalog-price-audit.rules";

function model(id: string, pricing: Partial<LLMModelPricing>): LLMModelEntry {
  return {
    id,
    name: id,
    provider: id.split("/")[0]!,
    pricing: { inputCostPerToken: 0, outputCostPerToken: 0, ...pricing },
    contextLength: 0,
    maxCompletionTokens: null,
    supportedParameters: [],
    defaultParameters: null,
    modality: "text->text",
    mode: "chat",
    supportsImageInput: false,
    supportsAudioInput: false,
    supportsImageOutput: false,
    supportsAudioOutput: false,
  };
}

const price = (p: Partial<LLMModelPricing>): LLMModelPricing => ({
  inputCostPerToken: 0,
  outputCostPerToken: 0,
  ...p,
});

describe("pricedUnits", () => {
  it("groups rate fields by the unit they bill in", () => {
    expect(pricedUnits(price({ inputCostPerToken: 1e-6 }))).toEqual(["token"]);
    expect(pricedUnits(price({ audioCostPerToken: 1e-5 }))).toEqual(["token"]);
    expect(pricedUnits(price({ inputCostPerCharacter: 1e-5 }))).toEqual(["character"]);
    expect(pricedUnits(price({ inputCostPerSecond: 1e-4 }))).toEqual(["second"]);
    expect(pricedUnits(price({}))).toEqual([]);
  });
});

describe("findUnpricedModels", () => {
  it("finds models that would bill every request at zero", () => {
    const models = {
      "openai/gpt-5": model("openai/gpt-5", { inputCostPerToken: 1e-6 }),
      "openai/tts-1": model("openai/tts-1", { inputCostPerCharacter: 1.5e-5 }),
      "openai/gpt-4o-transcribe": model("openai/gpt-4o-transcribe", {}),
    };
    expect(findUnpricedModels(models)).toEqual(["openai/gpt-4o-transcribe"]);
  });

  it("allows the models priced somewhere other than the catalog", () => {
    const models = {
      "openai_codex/gpt-5.6-sol": model("openai_codex/gpt-5.6-sol", {}),
      "openrouter/auto": model("openrouter/auto", {}),
      "openrouter/free": model("openrouter/free", {}),
    };
    expect(findUnpricedModels(models)).toEqual([]);
    expect(isPricedElsewhere("openrouter/auto")).toBe(true);
    expect(isPricedElsewhere("openai/gpt-4o-transcribe")).toBe(false);
  });

  it("counts a cache-only rate as priced", () => {
    const models = {
      "anthropic/cached": model("anthropic/cached", { inputCacheReadPerToken: 5e-8 }),
    };
    expect(findUnpricedModels(models)).toEqual([]);
  });
});

describe("auditCatalog", () => {
  it("reports an entry priced in a unit the vendor does not bill", () => {
    const overlay = {
      "openai/gpt-4o-transcribe": model("openai/gpt-4o-transcribe", { inputCostPerSecond: 1e-4 }),
    };
    const upstream = {
      litellm: {
        "openai/gpt-4o-transcribe": price({ inputCostPerToken: 2.5e-6, outputCostPerToken: 1e-5 }),
      },
    };
    const report = auditCatalog({ overlay, generated: {}, upstream });
    expect(report.unitMismatch).toEqual([
      {
        modelId: "openai/gpt-4o-transcribe",
        origin: "overlay",
        catalogUnits: ["second"],
        upstreamUnits: ["token"],
        source: "litellm",
      },
    ]);
  });

  it("stays quiet when the units overlap", () => {
    const overlay = {
      "openai/whisper-1": model("openai/whisper-1", { inputCostPerSecond: 1e-4 }),
    };
    const upstream = { litellm: { "openai/whisper-1": price({ inputCostPerSecond: 1e-4 }) } };
    const report = auditCatalog({ overlay, generated: {}, upstream });
    expect(report.unitMismatch).toEqual([]);
    expect(report.drift).toEqual([]);
  });

  it("reports a hand-written rate that disagrees with upstream", () => {
    const overlay = {
      "elevenlabs/eleven_multilingual_v2": model("elevenlabs/eleven_multilingual_v2", {
        inputCostPerCharacter: 0.0001,
      }),
    };
    const upstream = {
      litellm: { "elevenlabs/eleven_multilingual_v2": price({ inputCostPerCharacter: 0.00018 }) },
    };
    const { drift } = auditCatalog({ overlay, generated: {}, upstream });
    expect(drift).toHaveLength(1);
    expect(drift[0]).toMatchObject({
      modelId: "elevenlabs/eleven_multilingual_v2",
      origin: "overlay",
      field: "inputCostPerCharacter",
      catalog: 0.0001,
      upstream: 0.00018,
      source: "litellm",
    });
    expect(drift[0]!.gap).toBeCloseTo(0.444, 3);
  });

  it("reports a generated rate the two sources disagree on", () => {
    const generated = {
      "openai/gpt-audio-mini": model("openai/gpt-audio-mini", {
        inputCostPerToken: 6e-7,
        audioCostPerToken: 6e-7,
      }),
    };
    const upstream = {
      litellm: {
        "openai/gpt-audio-mini": price({ inputCostPerToken: 6e-7, audioCostPerToken: 1e-5 }),
      },
    };
    const { crossSource } = auditCatalog({ overlay: {}, generated, upstream });
    expect(crossSource).toHaveLength(1);
    expect(crossSource[0]).toMatchObject({
      modelId: "openai/gpt-audio-mini",
      origin: "generated",
      field: "audioCostPerToken",
    });
    expect(crossSource[0]!.gap).toBeCloseTo(0.94, 2);
  });

  it("ignores a gap small enough to be rounding", () => {
    const generated = { "openai/gpt-5": model("openai/gpt-5", { inputCostPerToken: 1.0e-6 }) };
    const upstream = { litellm: { "openai/gpt-5": price({ inputCostPerToken: 1.02e-6 }) } };
    expect(auditCatalog({ overlay: {}, generated, upstream }).crossSource).toEqual([]);
  });

  it("lists overlay entries that override the generated catalog", () => {
    const overlay = {
      "openai/gpt-audio-mini": model("openai/gpt-audio-mini", { audioCostPerToken: 1e-5 }),
    };
    const generated = {
      "openai/gpt-audio-mini": model("openai/gpt-audio-mini", { audioCostPerToken: 6e-7 }),
    };
    const report = auditCatalog({ overlay, generated, upstream: {} });
    expect(report.overriding).toEqual(["openai/gpt-audio-mini"]);
  });
});

describe("blockingFindings", () => {
  const report = {
    unpriced: ["gemini/lyria-3-pro-preview", "openai/brand-new"],
    unitMismatch: [
      {
        modelId: "openai/gpt-4o-transcribe",
        origin: "overlay" as const,
        catalogUnits: ["second"],
        upstreamUnits: ["token"],
        source: "litellm",
      },
    ],
    drift: [
      {
        modelId: "elevenlabs/eleven_multilingual_v2",
        origin: "overlay" as const,
        field: "inputCostPerCharacter",
        catalog: 0.0001,
        upstream: 0.00018,
        gap: 0.44,
        source: "litellm",
      },
    ],
    crossSource: [
      {
        modelId: "openai/gpt-audio-mini",
        origin: "generated" as const,
        field: "audioCostPerToken",
        catalog: 6e-7,
        upstream: 1e-5,
        gap: 0.94,
        source: "litellm",
      },
    ],
    overriding: [],
    unrepresentable: [],
  };

  const baseline: AuditBaseline = {
    unpriced: { "gemini/lyria-3-pro-preview": "priced per song, no per-clip unit" },
    unitMismatch: { "openai/gpt-4o-transcribe": "corrected on another pull request" },
    disagreements: {
      "elevenlabs/eleven_multilingual_v2::inputCostPerCharacter": "upstream may be the stale side",
    },
  };

  it("blocks only on findings the baseline does not already carry", () => {
    expect(blockingFindings(report, baseline)).toEqual(["no price: openai/brand-new"]);
  });

  it("blocks on everything when there is no baseline", () => {
    expect(blockingFindings(report, {})).toHaveLength(4);
  });

  it("never blocks on a disagreement between the two sources", () => {
    const onlyCrossSource = { ...report, unpriced: [], unitMismatch: [], drift: [] };
    expect(blockingFindings(onlyCrossSource, {})).toEqual([]);
  });
});

describe("renderAuditMarkdown", () => {
  const empty = {
    unpriced: [],
    unitMismatch: [],
    drift: [],
    crossSource: [],
    overriding: [],
    unrepresentable: [],
  };

  it("says so plainly when there is nothing to report", () => {
    expect(renderAuditMarkdown(empty, [])).toContain("No findings");
  });

  it("leads with the findings that need a decision", () => {
    const markdown = renderAuditMarkdown(
      {
        ...empty,
        unpriced: ["openai/brand-new"],
        crossSource: [
          {
            modelId: "openai/gpt-audio-mini",
            origin: "generated",
            field: "audioCostPerToken",
            catalog: 6e-7,
            upstream: 1e-5,
            gap: 0.94,
            source: "litellm",
          },
        ],
      },
      ["no price: openai/brand-new"],
    );
    expect(markdown).toContain("1 new finding(s) need a decision");
    expect(markdown).toContain("### No price (1)");
    expect(markdown).toContain("### The two price sources disagree (1)");
    expect(markdown).toContain("94%");
  });

  it("reports a held-back model without calling it a new finding", () => {
    const markdown = renderAuditMarkdown(
      {
        ...empty,
        unrepresentable: [{ id: "openai/gpt-realtime", fields: ["output_cost_per_audio_token"] }],
      },
      [],
    );
    expect(markdown).toContain("not expressible in the catalog (1)");
    expect(markdown).not.toContain("need a decision");
  });
});
