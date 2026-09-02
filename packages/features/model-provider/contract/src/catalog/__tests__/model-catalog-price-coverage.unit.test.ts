/**
 * Price coverage guard.
 *
 * A model the gateway can route must not be able to produce a confident
 * zero-dollar bill. Three separate faults do that, and all three look
 * identical from the product: the request is metered, the spend row settles,
 * and the amount is zero.
 *
 * 1. Missing. No rate at all on the entry.
 * 2. Wrong unit. A rate that prices a unit the model never reports. This is
 *    the one that reached production: gpt-4o-transcribe carried a per-second
 *    rate while the transcription response returns tokens and no duration,
 *    so the rated quantity was zero on every call and the entry still looked
 *    complete.
 * 3. Unreachable. A rate on an entry the cost matcher never selects, because
 *    a shorter model id earlier in the registry prefix-matches first.
 *
 * The audio family is where this bites, because it is the only part of the
 * catalog that bills in more than one unit.
 */
import { describe, expect, it } from "vitest";
import { estimateCost, matchModelCost } from "../../model-cost";
import type { ModelCostRate } from "../../model-provider";
import {
  baseModelCatalog,
  llmModels,
  overlayModelCatalog,
  overlayOverriddenModelIds,
} from "../model-catalog";
import type { LLMModelEntry } from "../model-catalog.types";
import { getStaticModelCostRates } from "../static-model-costs";

const getStaticModelCosts = getStaticModelCostRates;

/** The fallback cascade, under the name this guard has always used. */
const matchModelCostWithFallbacks = (model: string, costs: readonly ModelCostRate[]) =>
  matchModelCost(model, costs);

const baseModels = baseModelCatalog.models;
const overlayModels = overlayModelCatalog.models;

/**
 * Models the catalog prices at zero on purpose.
 *
 * Codex bills the user's ChatGPT plan. Every `openrouter/` id is a router
 * rather than a model: the price comes from whichever model it picks.
 */
const PRICED_ELSEWHERE = [/^openai_codex\//, /^openrouter\//];

/**
 * Models known to have no usable rate, each with the reason.
 *
 * This is debt, not permission. Removing a line is the goal; adding one
 * needs the reason written down.
 */
const KNOWN_UNPRICED: Record<string, string> = {
  "gemini/lyria-3-clip-preview":
    "Music generation billed per 30-second clip at $0.04. Both upstream sources report zero per token and the catalog has no per-clip unit.",
  "gemini/lyria-3-pro-preview":
    "Music generation billed per song at $0.08, same missing per-clip unit.",
};

const isPricedElsewhere = (modelId: string) =>
  PRICED_ELSEWHERE.some((pattern) => pattern.test(modelId));

/** One unit of every quantity the cost path can price. */
const ONE_OF_EVERYTHING = {
  inputTokens: 1,
  outputTokens: 1,
  cacheReadTokens: 1,
  cacheCreationTokens: 1,
  cacheCreation1hTokens: 1,
  inputAudioTokens: 1,
  outputAudioTokens: 1,
  inputCharacters: 1,
  audioSeconds: 1,
};

/** The unit an entry's rates bill in, from the rate fields it carries. */
function pricedUnits(entry: LLMModelEntry): Set<string> {
  const p = entry.pricing ?? {};
  const units = new Set<string>();
  if (
    (p.inputCostPerToken ?? 0) > 0 ||
    (p.outputCostPerToken ?? 0) > 0 ||
    (p.audioCostPerToken ?? 0) > 0 ||
    (p.inputCacheReadPerToken ?? 0) > 0 ||
    (p.inputCacheWritePerToken ?? 0) > 0
  ) {
    units.add("token");
  }
  if ((p.inputCostPerCharacter ?? 0) > 0) units.add("character");
  if ((p.inputCostPerSecond ?? 0) > 0) units.add("second");
  return units;
}

/**
 * The unit each audio model reports usage in, from the vendor's own price
 * page. Transcription reports either a duration or tokens, never both, and
 * which one is a property of the model, not of the endpoint.
 */
const BILLING_UNITS: Record<string, "token" | "character" | "second"> = {
  "openai/whisper-1": "second",
  "openai/gpt-transcribe": "second",
  "openai/gpt-4o-transcribe": "token",
  "openai/gpt-4o-mini-transcribe": "token",
  "openai/tts-1": "character",
  "openai/tts-1-hd": "character",
};

/**
 * Unit mismatches with a fix already in flight, each with where it is fixed.
 *
 * A line here is a promise to remove it. The honesty test below fails once
 * the entry is corrected, so the baseline cannot outlive the defect. Empty
 * is the goal state: every audio model prices a unit it can report.
 */
const KNOWN_UNIT_MISMATCH: Record<string, string> = {};

const catalogEntries = Object.entries(llmModels.models);

describe("catalog price coverage", () => {
  describe("given the merged model catalog", () => {
    it("loads a catalog worth checking", () => {
      expect(catalogEntries.length).toBeGreaterThan(100);
    });

    describe("when a model carries no rate at all", () => {
      it("finds none outside the known-unpriced list", () => {
        const unpriced = catalogEntries
          .filter(([id]) => !isPricedElsewhere(id))
          .filter(([, entry]) => pricedUnits(entry).size === 0)
          .map(([id]) => id)
          .sort();

        const unexpected = unpriced.filter((id) => !(id in KNOWN_UNPRICED));
        expect(
          unexpected,
          "A model with no rate bills every request at zero dollars and the spend row still settles. " +
            "Add the rate, or add the id to KNOWN_UNPRICED with the reason.",
        ).toEqual([]);
      });

      it("still finds every id the known-unpriced list claims", () => {
        // A model that gained a price must leave the list, or the list slowly
        // becomes a place where real gaps hide.
        const stillUnpriced = Object.keys(KNOWN_UNPRICED).filter((id) => {
          const entry = llmModels.models[id];
          return !entry || pricedUnits(entry).size === 0;
        });
        expect(stillUnpriced.sort()).toEqual(Object.keys(KNOWN_UNPRICED).sort());
      });
    });

    describe("when every billable quantity is one", () => {
      it("rates a cost above zero for every priced model", () => {
        const costs = getStaticModelCosts();
        const zeroRated: string[] = [];

        for (const [id] of catalogEntries) {
          if (isPricedElsewhere(id) || id in KNOWN_UNPRICED) continue;

          const matched = matchModelCostWithFallbacks(id, costs);
          if (!matched) {
            zeroRated.push(`${id} (no cost rule matched)`);
            continue;
          }
          const cost = estimateCost({
            rate: matched,
            ...ONE_OF_EVERYTHING,
          });
          if (!cost || cost <= 0) {
            zeroRated.push(`${id} (matched ${matched.model}, rated ${cost ?? 0})`);
          }
        }

        expect(
          zeroRated,
          "These models rate zero even when every billable quantity is one, so a real request bills nothing.",
        ).toEqual([]);
      });
    });
  });

  describe("given an audio model, which bills in more than one unit", () => {
    describe("when the cost matcher picks its rule", () => {
      it("picks that model's own rule, not a shorter prefix", () => {
        // `openai/gpt-4o-transcribe` prefix-matches `openai/gpt-4o` unless it
        // has its own entry, which is how a transcription request came to be
        // priced with chat token rates.
        const costs = getStaticModelCosts();
        const misrouted: string[] = [];

        for (const [id, entry] of catalogEntries) {
          if (entry.mode !== "audio") continue;
          const matched = matchModelCostWithFallbacks(id, costs);
          if (matched?.model !== id) {
            misrouted.push(`${id} -> ${matched?.model ?? "no match"}`);
          }
        }

        expect(
          misrouted,
          "An audio model matched to another model's rule is billed in that model's units.",
        ).toEqual([]);
      });
    });

    describe("when its rate is compared with the unit the vendor bills", () => {
      it("prices a unit the model can actually report", () => {
        // Transcription that bills per second needs a duration; transcription
        // that bills per token needs tokens. An entry carrying only the unit
        // the API does not return rates every request at zero, and still
        // looks like a complete entry.
        const wrong: string[] = [];
        for (const [id, unit] of Object.entries(BILLING_UNITS)) {
          if (id in KNOWN_UNIT_MISMATCH) continue;
          const entry = llmModels.models[id];
          if (!entry) continue; // covered by the coverage tests above
          const units = pricedUnits(entry);
          if (!units.has(unit)) {
            wrong.push(
              `${id} prices ${[...units].join("+") || "nothing"}, bills ${unit}`,
            );
          }
        }
        expect(
          wrong,
          "A rate in the wrong unit rates every request at zero. Fix the rate, or add the id to KNOWN_UNIT_MISMATCH with where the fix lands.",
        ).toEqual([]);
      });

      it("still finds every id the known-mismatch list claims", () => {
        // Once an entry is corrected its line must go, or the baseline becomes
        // a place where the next mismatch hides.
        const stillWrong = Object.keys(KNOWN_UNIT_MISMATCH).filter((id) => {
          const entry = llmModels.models[id];
          const unit = BILLING_UNITS[id];
          if (!entry || !unit) return true;
          return !pricedUnits(entry).has(unit);
        });
        expect(
          stillWrong.sort(),
          "An entry in KNOWN_UNIT_MISMATCH now prices the right unit. Delete its line.",
        ).toEqual(Object.keys(KNOWN_UNIT_MISMATCH).sort());
      });
    });
  });
});

describe("overlay precedence", () => {
  describe("given an overlay entry whose id the base catalog also carries", () => {
    describe("when the catalog is merged", () => {
      it("puts the hand-written entry in force", () => {
        // The overlay is the correction lane. When it loses to the base file
        // it cannot correct a wrong generated rate, which is the whole reason
        // it exists.
        for (const id of overlayOverriddenModelIds) {
          expect(
            llmModels.models[id]?.pricing,
            `overlay entry ${id} is not the one in force`,
          ).toEqual(overlayModels[id]?.pricing);
        }
      });
    });
  });

  describe("given gpt-audio-mini, whose generated audio rate is its text rate", () => {
    describe("when the catalog is merged", () => {
      it("prices audio input at the published rate, not the text rate", () => {
        // One upstream source reports this model's audio input rate as its
        // text rate, sixteen times under the published price. The overlay
        // corrects it, which only works while the overlay wins the merge.
        // The cost layer does not price audio tokens yet; langwatch#7021 adds
        // that, and derives the output rate from the input rate asserted here.
        // Correcting the input rate first is what stops that derivation from
        // producing a wrong output rate.
        const entry = llmModels.models["openai/gpt-audio-mini"];
        expect(entry).toBeDefined();
        expect(entry!.pricing.audioCostPerToken).toBe(1e-5);
        expect(entry!.pricing.inputCostPerToken).toBe(6e-7);
        expect(overlayOverriddenModelIds).toContain("openai/gpt-audio-mini");
      });
    });
  });

  // Everything above reads the merged catalog object. That is not the thing
  // that bills. `getStaticModelCosts` builds the cost registry, and if it
  // were ever pointed at the generated file instead of the merged catalog,
  // every assertion above would still pass while billing quietly stopped
  // honouring the overlay. These two pin the wiring itself.
  describe("given the cost registry the runtime bills from", () => {
    describe("when a model exists only in the overlay", () => {
      it("still reaches the registry, at the overlay's rates", () => {
        // gpt-5.3-chat was delisted from the generated catalog while still
        // reachable through the gateway. It survives only because the overlay
        // carries it. Without it the id prefix-matches openai/gpt-5 and bills
        // 29 percent under, which is what this asserts against.
        const overlayOnly = Object.keys(overlayModels).filter(
          (id) => !(id in baseModels),
        );
        expect(
          overlayOnly,
          "expected at least one overlay-only model to test the wiring with",
        ).toContain("openai/gpt-5.3-chat");

        const costs = getStaticModelCosts();
        for (const id of overlayOnly) {
          if (isPricedElsewhere(id)) continue;
          const matched = matchModelCostWithFallbacks(id, costs);
          expect(
            matched?.model,
            `${id} exists only in the overlay and the cost registry resolved it to ${matched?.model ?? "nothing"}, so the overlay is not reaching billing`,
          ).toBe(id);
          // Resolving to the right id is not the same as carrying the right
          // rates: a rule can take the overlay's name and stale numbers.
          expect(
            matched?.inputCostPerToken,
            `${id} resolved to its own rule but not at the overlay's input rate`,
          ).toBe(overlayModels[id]?.pricing.inputCostPerToken ?? 0);
          expect(
            matched?.outputCostPerToken,
            `${id} resolved to its own rule but not at the overlay's output rate`,
          ).toBe(overlayModels[id]?.pricing.outputCostPerToken ?? 0);
        }
      });
    });

    describe("when the overlay overrides a generated entry", () => {
      it("bills the overlay's rate, not the generated one", () => {
        // Note on reach: today's only override, gpt-audio-mini, corrects
        // `audioCostPerToken`, and the cost registry does not carry that
        // field, so the token-rate assertions below cannot tell the two
        // sources apart for it. Precedence itself is caught by the
        // catalog-level test above. These bite the moment an override
        // corrects a token rate, which is the common case.
        const costs = getStaticModelCosts();
        for (const id of overlayOverriddenModelIds) {
          if (isPricedElsewhere(id)) continue;
          const matched = matchModelCostWithFallbacks(id, costs);
          expect(matched?.model, `${id} did not resolve to its own rule`).toBe(id);
          expect(
            matched?.inputCostPerToken,
            `${id} bills the generated input rate rather than the overlay's`,
          ).toBe(overlayModels[id]?.pricing.inputCostPerToken ?? 0);
          expect(
            matched?.outputCostPerToken,
            `${id} bills the generated output rate rather than the overlay's`,
          ).toBe(overlayModels[id]?.pricing.outputCostPerToken ?? 0);
        }
      });
    });
  });
});
