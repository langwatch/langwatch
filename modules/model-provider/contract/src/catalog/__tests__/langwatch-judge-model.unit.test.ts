/**
 * LangWatch Judge (preview) in the catalogue: which keys may hold it and how a picker lists it.
 * @see specs/model-providers/judge-default-model.feature
 */
import { describe, expect, it } from "vitest";

import {
  judgeColumnModelIds,
  judgePickerOptions,
  langwatchJudgePickerOption,
} from "../../model-options.ts";
import { isModelAllowedAsRoleDefault, isModelAllowedForFeature } from "../codex-restrictions.ts";
import {
  isLangWatchModelFillingRole,
  LANGWATCH_DECISION_PREVIEWS,
  LANGWATCH_JUDGE_MODEL_ID,
  picksLangWatchJudgeModel,
  writtenModelId,
} from "../decision-models.ts";
import { allFeatures, MODEL_ROLES } from "../model-feature-registry.ts";

describe("LangWatch Judge (preview) in the catalogue", () => {
  /** @scenario "LangWatch Judge (preview) may be held by the Judge column and the scenario judge only" */
  it("may be the Judge column's default and no other column's", () => {
    const holders = MODEL_ROLES.filter((role) =>
      isModelAllowedAsRoleDefault(LANGWATCH_JUDGE_MODEL_ID, role),
    );

    expect(holders).toEqual(["JUDGE"]);
    expect(isLangWatchModelFillingRole(LANGWATCH_JUDGE_MODEL_ID, "JUDGE")).toBe(true);
    expect(isLangWatchModelFillingRole(LANGWATCH_JUDGE_MODEL_ID, "INSTANT_EVALS")).toBe(false);
  });

  /** @scenario "LangWatch Judge (preview) may be held by the Judge column and the scenario judge only" */
  it("may be the scenario judge's model and no other feature's", () => {
    const holders = allFeatures()
      .filter(({ key }) =>
        isModelAllowedForFeature({ modelId: LANGWATCH_JUDGE_MODEL_ID, featureKey: key }),
      )
      .map(({ key }) => key);

    expect(holders).toEqual(["scenarios.judge"]);
  });

  it("is stored under its own id, never rewritten to the decision model's", () => {
    expect(writtenModelId(LANGWATCH_JUDGE_MODEL_ID)).toBe("langwatch/judge-preview");
  });
});

describe("judgePickerOptions", () => {
  const llmOptions = [{ label: "gpt-6.1-sol", value: "openai/gpt-6.1-sol", subtitle: "" }];

  /** @scenario "The Judge picker lists LangWatch Judge (preview) first where its flag is on" */
  it("lists LangWatch Judge (preview) first, named from the catalogue, then the LLMs", () => {
    const options = judgePickerOptions({ llmOptions, isJudgePreviewOffered: true });

    expect(options).toEqual([
      {
        label: "LangWatch Judge (preview)",
        value: "langwatch/judge-preview",
        subtitle: "Optimized for scenario judge",
      },
      ...llmOptions,
    ]);
    expect(options[0]).toEqual(langwatchJudgePickerOption());
  });

  /** @scenario "The Judge picker never lists LangWatch Judge (preview) where its flag is off" */
  it("lists only the LLMs with the flag off, even when one was handed in", () => {
    const options = judgePickerOptions({
      llmOptions: [langwatchJudgePickerOption(), ...llmOptions],
      isJudgePreviewOffered: false,
    });

    expect(options).toEqual(llmOptions);
  });
});

describe("judgeColumnModelIds", () => {
  it("is every LangWatch model whose catalogue entry fills Judge, and none with the flag off", () => {
    const filling = LANGWATCH_DECISION_PREVIEWS.filter(({ fills }) => fills.includes("JUDGE"));

    expect(judgeColumnModelIds({ isJudgePreviewOffered: true })).toEqual(
      filling.map(({ id }) => id),
    );
    expect(judgeColumnModelIds({ isJudgePreviewOffered: true })).toEqual([
      LANGWATCH_JUDGE_MODEL_ID,
    ]);
    expect(judgeColumnModelIds({ isJudgePreviewOffered: false })).toEqual([]);
  });
});

describe("picksLangWatchJudgeModel", () => {
  /** @scenario "Saving LangWatch Judge (preview) is refused where its flag is off" */
  it("is a new pick only where the stored value differs", () => {
    const config = { JUDGE: LANGWATCH_JUDGE_MODEL_ID, DEFAULT: "openai/gpt-5.5" };

    expect(picksLangWatchJudgeModel({ config })).toBe(true);
    expect(picksLangWatchJudgeModel({ config, stored: { JUDGE: "openai/gpt-5.5" } })).toBe(true);
    expect(picksLangWatchJudgeModel({ config, stored: { JUDGE: LANGWATCH_JUDGE_MODEL_ID } })).toBe(
      false,
    );
    expect(picksLangWatchJudgeModel({ config: { JUDGE: "openai/gpt-5.5" } })).toBe(false);
  });
});
