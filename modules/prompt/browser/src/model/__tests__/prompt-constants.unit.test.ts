import { findLatestOpenAIChatFlagship, findModelById } from "@langwatch/model-provider-contract";
/**
 * `DEFAULT_MODEL` is auto-derived from the model registry, so drift is impossible by
 * construction.
 * @see specs/prompts/prompt-sync-fidelity.feature
 */
import { describe, expect, it } from "vitest";

import { DEFAULT_MODEL } from "../prompt-constants.ts";

describe("prompt sync fidelity — default prompt model", () => {
  /** @scenario "The default prompt model is a current model the registry still serves" */
  it("auto-derives the newest OpenAI flagship from the registry", () => {
    const latest = findLatestOpenAIChatFlagship()[0];
    expect(latest, "registry has no openai chat flagship").toBeTruthy();
    expect(DEFAULT_MODEL).toBe(latest);

    const entry = findModelById(DEFAULT_MODEL)[0];
    expect(entry, `${DEFAULT_MODEL} is not in the model registry`).toBeTruthy();

    expect(entry!.supportedParameters).toEqual(expect.arrayContaining(["response_format"]));

    expect(DEFAULT_MODEL).toMatch(/^openai\/gpt-(\d+)\.(\d+)$/);
    expect(DEFAULT_MODEL).not.toMatch(/^openai\/gpt-[0-4]([.-]|$)/);
  });
});
