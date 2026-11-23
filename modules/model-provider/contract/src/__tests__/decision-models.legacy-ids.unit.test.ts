/**
 * LangWatch's model ids share a -preview suffix; earlier ids stay accepted on read.
 * @see specs/model-providers/instant-evals-decision-model.feature
 */
import { describe, expect, it } from "vitest";

import {
  canonicalModelId,
  findDecisionModel,
  isDecisionModelId,
  isOwnDecisionModelId,
  LANGWATCH_DECISION_MODEL_ID,
  LANGWATCH_DECISION_PREVIEWS,
  LANGWATCH_EVALS_MODEL_ID,
  LEGACY_LANGWATCH_MODEL_IDS,
} from "../catalog/decision-models.ts";

describe("LangWatch model ids", () => {
  /** @scenario "Picking Instant Preview by its id finds the hosted model" */
  it("finds the hosted Instant Preview by langwatch/instant-preview", () => {
    expect(LANGWATCH_DECISION_MODEL_ID).toBe("langwatch/instant-preview");
    expect(findDecisionModel("langwatch/instant-preview")).toMatchObject({
      id: "langwatch/instant-preview",
      label: "Instant Preview",
      provider: "langwatch",
    });
    expect(isOwnDecisionModelId("langwatch/instant-preview")).toBe(false);
  });

  /** @scenario "Picking Evals Preview by its id finds the hosted judge router" */
  it("finds the hosted Evals Preview by langwatch/evals-preview", () => {
    expect(LANGWATCH_EVALS_MODEL_ID).toBe("langwatch/evals-preview");
    expect(findDecisionModel("langwatch/evals-preview")).toMatchObject({
      id: "langwatch/evals-preview",
      label: "Evals Preview",
      description: "Optimized for evals",
      provider: "langwatch",
    });
    expect(isOwnDecisionModelId("langwatch/evals-preview")).toBe(false);
  });

  /** @scenario "An earlier LangWatch model id still resolves to the renamed model" */
  it.each([
    ["langwatch/instant-evals", "langwatch/instant-preview"],
    ["langwatch/search-preview", "langwatch/instant-preview"],
    ["langwatch/scenario-judge-preview", "langwatch/judge-preview"],
  ])("reads %s as %s", (legacy, current) => {
    expect(canonicalModelId(legacy)).toBe(current);
  });

  /** @scenario "An earlier LangWatch model id still resolves to the renamed model" */
  it("runs a stored langwatch/instant-evals on the hosted model, never as an own key", () => {
    expect(findDecisionModel("langwatch/instant-evals")?.id).toBe(LANGWATCH_DECISION_MODEL_ID);
    expect(isDecisionModelId("langwatch/instant-evals")).toBe(true);
    expect(isOwnDecisionModelId("langwatch/instant-evals")).toBe(false);
  });

  it("leaves every other id as it is", () => {
    for (const id of ["openai/gpt-5.4-mini", "openai/decisions:gpt-6-luna", "toString", ""]) {
      expect(canonicalModelId(id)).toBe(id);
    }
  });

  /** @scenario "Pickers list only the new LangWatch model ids" */
  it("lists only the new ids among LangWatch's decision models", () => {
    const ids = LANGWATCH_DECISION_PREVIEWS.map((preview) => preview.id);
    expect(ids).toEqual([
      "langwatch/instant-preview",
      "langwatch/evals-preview",
      "langwatch/judge-preview",
    ]);
    expect(ids.filter((id) => Object.hasOwn(LEGACY_LANGWATCH_MODEL_IDS, id))).toEqual([]);
    expect(LANGWATCH_DECISION_PREVIEWS.map((preview) => preview.label)).toEqual([
      "Instant Preview",
      "Evals Preview",
      "Judge Preview",
    ]);
  });
});
