import { LANGWATCH_DECISION_MODEL_ID } from "@langwatch/model-provider-contract";
import { describe, expect, it } from "vitest";

import {
  decisionModelPickerOptions,
  ROUTED_HOSTED_DECISION_MODEL_SUBTITLE,
  rolePickerOptions,
} from "../decision-model-options.ts";

const HOSTED = { value: LANGWATCH_DECISION_MODEL_ID, label: "Evals Preview" };
const OPENAI = { value: "openai/decisions:gpt-6-luna", label: "OpenAI Decisions" };
const LANGWATCH_TITLES = ["Evals Preview", "Scenario Judge Preview", "Search Preview"];

describe("decisionModelPickerOptions", () => {
  const hostedSubtitle = (isJudgeRouted: boolean) =>
    decisionModelPickerOptions({ pickable: [], isJudgeRouted, isOwnModelEnabled: true }).find(
      (option) => option.value === LANGWATCH_DECISION_MODEL_ID,
    )?.subtitle;

  /** @scenario "With the router flag on LangWatch Evals Preview says it routes" */
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
        expect.arrayContaining(["Inception Mercury Decide", "Decisions API"]),
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

  it("lists only LangWatch's models while the offer is not loaded", () => {
    const options = decisionModelPickerOptions({
      pickable: undefined,
      isJudgeRouted: true,
      isOwnModelEnabled: true,
    });
    expect(options.map((option) => option.label)).toEqual(LANGWATCH_TITLES);
  });

  it("lists only LangWatch's models, with no add-a-key hint, when own decision models are off", () => {
    const options = decisionModelPickerOptions({
      pickable: [HOSTED],
      isJudgeRouted: true,
      isOwnModelEnabled: false,
    });
    expect(options.map((option) => option.label)).toEqual(LANGWATCH_TITLES);
  });

  it("lists Evals Preview alone, no coming-soon preview, with the router flag off", () => {
    const options = decisionModelPickerOptions({
      pickable: [HOSTED],
      isJudgeRouted: false,
      isOwnModelEnabled: false,
    });
    expect(options.map((option) => option.label)).toEqual(["Evals Preview"]);
  });

  it("lists the previews that are not hosted yet as coming soon, unpickable", () => {
    const options = decisionModelPickerOptions({
      pickable: [HOSTED],
      isJudgeRouted: true,
      isOwnModelEnabled: false,
    });
    expect(options[0]?.disabled).toBeFalsy();
    for (const preview of options.slice(1)) {
      expect(preview).toMatchObject({ disabled: true, hint: "Coming soon" });
    }
  });
});

describe("rolePickerOptions", () => {
  const decisionOptions = decisionModelPickerOptions({
    pickable: [HOSTED, OPENAI],
    isJudgeRouted: true,
    isOwnModelEnabled: true,
  });
  const llmOptions = [{ label: "gpt-6.1-sol", value: "openai/gpt-6.1-sol" }];

  /** @scenario "The Judge picker lists no decision model" */
  it("lists only the LLMs in the Judge picker, no LangWatch or own decision model", () => {
    expect(rolePickerOptions({ role: "JUDGE", decisionOptions, llmOptions })).toEqual(llmOptions);
  });

  it("offers decision models only in the Instant Evals picker", () => {
    expect(rolePickerOptions({ role: "INSTANT_EVALS", decisionOptions, llmOptions })).toEqual(
      decisionOptions,
    );
  });

  it("leaves the other columns to the LLMs", () => {
    expect(rolePickerOptions({ role: "DEFAULT", decisionOptions, llmOptions })).toEqual(llmOptions);
  });
});
