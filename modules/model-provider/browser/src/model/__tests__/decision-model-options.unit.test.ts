import { LANGWATCH_DECISION_MODEL_ID } from "@langwatch/model-provider-contract";
import { describe, expect, it } from "vitest";

import {
  decisionModelPickerOptions,
  ROUTED_HOSTED_DECISION_MODEL_SUBTITLE,
  rolePickerModels,
} from "../decision-model-options.ts";

const HOSTED = { value: LANGWATCH_DECISION_MODEL_ID, label: "Evals Preview" };
const OPENAI = { value: "openai/decisions:gpt-6-luna", label: "OpenAI Decisions (gpt-6-luna)" };

describe("decisionModelPickerOptions", () => {
  const hostedSubtitle = (isJudgeRouted: boolean) =>
    decisionModelPickerOptions({ pickable: [], isJudgeRouted, isOwnModelEnabled: true }).find(
      (option) => option.value === LANGWATCH_DECISION_MODEL_ID,
    )?.subtitle;

  /** @scenario "With the router flag on LangWatch Instant Preview says it routes" */
  it("says Evals Preview routes when the judge router flag is on", () => {
    expect(hostedSubtitle(true)).toBe(ROUTED_HOSTED_DECISION_MODEL_SUBTITLE);
  });

  it("reads Optimized for evals when the judge router flag is off", () => {
    expect(hostedSubtitle(false)).toBe("Optimized for evals");
  });

  describe("given own decision models are on", () => {
    const options = decisionModelPickerOptions({
      pickable: [HOSTED, OPENAI],
      isJudgeRouted: false,
      isOwnModelEnabled: true,
    });

    it("lists LangWatch's model first, then every catalogue model", () => {
      expect(options[0]?.value).toBe(LANGWATCH_DECISION_MODEL_ID);
      expect(options.map((option) => option.label)).toEqual(
        expect.arrayContaining(["Inception Mercury Decide", "Azure OpenAI Decisions (gpt-6-luna)"]),
      );
    });

    it("describes a model that would run and lets it be picked", () => {
      const openai = options.find((option) => option.value === OPENAI.value);
      expect(openai).toMatchObject({ subtitle: "OpenAI's Decisions API, on your OpenAI key." });
      expect(openai?.disabled).toBeFalsy();
    });

    it("tells how to enable a model whose provider has no key, and keeps it unpickable", () => {
      const inception = options.find((option) => option.label === "Inception Mercury Decide");
      expect(inception).toMatchObject({
        subtitle: "Add an Inception key in Model Providers to use it.",
        disabled: true,
      });
      const cloudflare = options.find((option) => option.label === "Cloudflare Clef");
      expect(cloudflare?.subtitle).toBe(
        "Add a Cloudflare Workers AI key in Model Providers to use it.",
      );
    });
  });

  it("lists only LangWatch's model while the offer is not loaded", () => {
    const options = decisionModelPickerOptions({
      pickable: undefined,
      isJudgeRouted: false,
      isOwnModelEnabled: true,
    });
    expect(options.map((option) => option.value)).toEqual([LANGWATCH_DECISION_MODEL_ID]);
  });

  it("lists only LangWatch's model, with no add-a-key hint, when own decision models are off", () => {
    const options = decisionModelPickerOptions({
      pickable: [HOSTED],
      isJudgeRouted: false,
      isOwnModelEnabled: false,
    });
    expect(options.map((option) => option.value)).toEqual([LANGWATCH_DECISION_MODEL_ID]);
  });
});

describe("rolePickerModels", () => {
  const decisions = [LANGWATCH_DECISION_MODEL_ID, OPENAI.value];
  const llms = ["openai/gpt-6.1-sol", "anthropic/claude-sonnet-4-6"];

  /** @scenario "The Judge picker lists decision models before LLMs" */
  it("puts decision models before every LLM in the Judge picker", () => {
    expect(rolePickerModels({ role: "JUDGE", decisionModels: decisions, llmModels: llms })).toEqual(
      [...decisions, ...llms],
    );
  });

  it("offers decision models only in the Instant Evals picker", () => {
    expect(
      rolePickerModels({ role: "INSTANT_EVALS", decisionModels: decisions, llmModels: llms }),
    ).toEqual(decisions);
  });
});
