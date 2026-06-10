import { describe, it, expect } from "vitest";
import { DEFAULT_MODEL } from "../constants";
import { getModelById } from "~/server/modelProviders/registry";
import { getLatestOpenAIChatFlagship } from "~/server/modelProviders/getLatestFlagship";

/**
 * `DEFAULT_MODEL` is auto-derived from the model registry, so drift is
 * impossible by construction. The remaining guarantees worth pinning:
 * the helper still finds an OpenAI flagship, that flagship is in the
 * registry, and it supports structured outputs (the whole point of a
 * modern default for prompts that return strict JSON).
 */
describe("prompt sync fidelity — default prompt model", () => {
  /** @scenario The default prompt model is a current model the registry still serves */
  it("auto-derives the newest OpenAI flagship from the registry", () => {
    const latest = getLatestOpenAIChatFlagship();
    expect(latest, "registry has no openai chat flagship").toBeTruthy();
    expect(DEFAULT_MODEL).toBe(latest);

    const entry = getModelById(DEFAULT_MODEL);
    expect(entry, `${DEFAULT_MODEL} is not in the model registry`).toBeTruthy();

    expect(entry!.supportedParameters).toEqual(
      expect.arrayContaining(["response_format"]),
    );

    // Sanity: pattern must be a plain gpt-<major>.<minor> flagship, not a
    // legacy gpt-4 / gpt-3.x generation.
    expect(DEFAULT_MODEL).toMatch(/^openai\/gpt-(\d+)\.(\d+)$/);
    expect(DEFAULT_MODEL).not.toMatch(/^openai\/gpt-[0-4]([.-]|$)/);
  });
});
