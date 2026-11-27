/**
 * LangWatch's model ids share a -preview suffix: every id is read, writes keep the earlier one.
 * @see specs/model-providers/instant-evals-decision-model.feature
 */
import { describe, expect, it } from "vitest";

import {
  isModelAllowedAsRoleDefault,
  isModelAllowedForFeature,
} from "../catalog/codex-restrictions.ts";
import {
  canonicalModelId,
  findDecisionModel,
  INSTANT_EVAL_DECISION_FEATURE_KEY,
  isDecisionModelId,
  isOwnDecisionModelId,
  judgeShownModelIdOf,
  LANGWATCH_DECISION_MODEL_ID,
  LANGWATCH_DECISION_PREVIEWS,
  LANGWATCH_EVALS_MODEL_ID,
  LANGWATCH_WRITTEN_MODEL_ID,
  LEGACY_LANGWATCH_MODEL_IDS,
  writtenModelId,
} from "../catalog/decision-models.ts";

describe("LangWatch model ids", () => {
  /** @scenario "Picking LangWatch Instant (preview) by its id finds the hosted model" */
  it("finds the hosted LangWatch Instant (preview) by langwatch/instant-preview", () => {
    expect(LANGWATCH_DECISION_MODEL_ID).toBe("langwatch/instant-preview");
    expect(findDecisionModel("langwatch/instant-preview")).toMatchObject({
      id: "langwatch/instant-preview",
      label: "LangWatch Instant (preview)",
      provider: "langwatch",
    });
    expect(isOwnDecisionModelId("langwatch/instant-preview")).toBe(false);
  });

  /** @scenario "Picking LangWatch Evals (preview) by its id finds the hosted judge router" */
  it("finds the hosted LangWatch Evals (preview) by langwatch/evals-preview", () => {
    expect(LANGWATCH_EVALS_MODEL_ID).toBe("langwatch/evals-preview");
    expect(findDecisionModel("langwatch/evals-preview")).toMatchObject({
      id: "langwatch/evals-preview",
      label: "LangWatch Evals (preview)",
      description: "Optimized for evals",
      provider: "langwatch",
    });
    expect(isOwnDecisionModelId("langwatch/evals-preview")).toBe(false);
  });

  /** @scenario "The earlier LangWatch model id still resolves to the renamed model" */
  it("reads langwatch/instant-evals as langwatch/instant-preview", () => {
    expect(canonicalModelId("langwatch/instant-evals")).toBe("langwatch/instant-preview");
  });

  /** @scenario "The earlier LangWatch model id still resolves to the renamed model" */
  it("runs a stored langwatch/instant-evals on the hosted model, never as an own key", () => {
    expect(findDecisionModel("langwatch/instant-evals")?.id).toBe(LANGWATCH_DECISION_MODEL_ID);
    expect(isDecisionModelId("langwatch/instant-evals")).toBe(true);
    expect(isOwnDecisionModelId("langwatch/instant-evals")).toBe(false);
  });

  /** @scenario "The earlier LangWatch model id still resolves to the renamed model" */
  it.each(["langwatch/search-preview", "langwatch/scenario-judge-preview"])(
    "drops the never-stored coming-soon id %s",
    (id) => {
      expect(canonicalModelId(id)).toBe(id);
      expect(isDecisionModelId(id)).toBe(false);
    },
  );

  /** @scenario "Saving a config stores LangWatch's model under the id the previous release reads" */
  it("writes every LangWatch hosted id as langwatch/instant-evals, any other id as it is", () => {
    expect(LANGWATCH_WRITTEN_MODEL_ID).toBe("langwatch/instant-evals");
    for (const id of [
      "langwatch/instant-preview",
      "langwatch/evals-preview",
      "langwatch/instant-evals",
    ]) {
      expect(writtenModelId(id)).toBe("langwatch/instant-evals");
    }
    expect(writtenModelId("openai/decisions:gpt-6-luna")).toBe("openai/decisions:gpt-6-luna");
    expect(writtenModelId("openai/gpt-5.4-mini")).toBe("openai/gpt-5.4-mini");
  });

  /** @scenario "A judge saved on the old id shows LangWatch Evals (preview) where routing is on" */
  it("shows a routed judge on either routed id as the written id the picker names LangWatch Evals (preview)", () => {
    for (const id of ["langwatch/instant-evals", "langwatch/evals-preview"]) {
      expect(judgeShownModelIdOf({ id, isJudgeRouted: true })).toBe("langwatch/instant-evals");
    }
  });

  /** @scenario "A judge on the LangWatch Evals (preview) id shows as LangWatch Instant (preview) where routing is off" */
  it("shows every hosted id as the written id where routing is off", () => {
    for (const id of [
      "langwatch/instant-evals",
      "langwatch/evals-preview",
      "langwatch/instant-preview",
    ]) {
      expect(judgeShownModelIdOf({ id, isJudgeRouted: false })).toBe("langwatch/instant-evals");
    }
  });

  /** @scenario "A judge on the LangWatch Instant (preview) id keeps its name where routing is on" */
  it("keeps the LangWatch Instant (preview) id where routing is on, and leaves own models as they are", () => {
    expect(judgeShownModelIdOf({ id: "langwatch/instant-preview", isJudgeRouted: true })).toBe(
      "langwatch/instant-preview",
    );
    expect(judgeShownModelIdOf({ id: "openai/decisions:gpt-6-luna", isJudgeRouted: true })).toBe(
      "openai/decisions:gpt-6-luna",
    );
  });

  /** @scenario "The Instant Evals column refuses LangWatch Evals (preview)" */
  it("refuses LangWatch Evals (preview) for the column and its feature, allows the rest", () => {
    expect(isModelAllowedAsRoleDefault("langwatch/evals-preview", "INSTANT_EVALS")).toBe(false);
    expect(
      isModelAllowedForFeature({
        modelId: "langwatch/evals-preview",
        featureKey: INSTANT_EVAL_DECISION_FEATURE_KEY,
      }),
    ).toBe(false);
    for (const id of [
      "langwatch/instant-preview",
      "langwatch/instant-evals",
      "openai/decisions:gpt-6-luna",
    ]) {
      expect(isModelAllowedAsRoleDefault(id, "INSTANT_EVALS")).toBe(true);
      expect(
        isModelAllowedForFeature({ modelId: id, featureKey: INSTANT_EVAL_DECISION_FEATURE_KEY }),
      ).toBe(true);
    }
    expect(isModelAllowedAsRoleDefault("langwatch/judge-preview", "INSTANT_EVALS")).toBe(false);
  });

  it("leaves every other id as it is", () => {
    for (const id of ["openai/gpt-5.4-mini", "openai/decisions:gpt-6-luna", "toString", ""]) {
      expect(canonicalModelId(id)).toBe(id);
    }
  });

  it("lists only the new ids among LangWatch's decision models", () => {
    const ids = LANGWATCH_DECISION_PREVIEWS.map((preview) => preview.id);
    expect(ids).toEqual([
      "langwatch/instant-preview",
      "langwatch/evals-preview",
      "langwatch/judge-preview",
    ]);
    expect(ids.filter((id) => Object.hasOwn(LEGACY_LANGWATCH_MODEL_IDS, id))).toEqual([]);
    expect(LANGWATCH_DECISION_PREVIEWS.map((preview) => preview.label)).toEqual([
      "LangWatch Instant (preview)",
      "LangWatch Evals (preview)",
      "LangWatch Judge (preview)",
    ]);
  });
});
