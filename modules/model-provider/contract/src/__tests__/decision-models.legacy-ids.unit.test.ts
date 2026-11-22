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
  LEGACY_LANGWATCH_MODEL_IDS,
} from "../catalog/decision-models.ts";

describe("LangWatch model ids", () => {
  /** @scenario "Picking Evals Preview by its id finds the hosted model" */
  it("finds the hosted Evals Preview by langwatch/evals-preview", () => {
    expect(LANGWATCH_DECISION_MODEL_ID).toBe("langwatch/evals-preview");
    expect(findDecisionModel("langwatch/evals-preview")).toMatchObject({
      id: "langwatch/evals-preview",
      label: "Evals Preview",
      provider: "langwatch",
    });
    expect(isOwnDecisionModelId("langwatch/evals-preview")).toBe(false);
  });

  /** @scenario "An earlier LangWatch model id still resolves to the renamed model" */
  it.each([
    ["langwatch/instant-evals", "langwatch/evals-preview"],
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
      "langwatch/evals-preview",
      "langwatch/judge-preview",
      "langwatch/instant-preview",
    ]);
    expect(ids.filter((id) => Object.hasOwn(LEGACY_LANGWATCH_MODEL_IDS, id))).toEqual([]);
    expect(LANGWATCH_DECISION_PREVIEWS.map((preview) => preview.label)).toEqual([
      "Evals Preview",
      "Judge Preview",
      "Instant Preview",
    ]);
  });
});
