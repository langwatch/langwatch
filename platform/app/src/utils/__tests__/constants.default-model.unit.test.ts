import { describe, expect, it } from "vitest";
import { resolveLatestAlias } from "~/server/modelProviders/latestAliases";
import { getModelById } from "~/server/modelProviders/registry";
import { DEFAULT_MODEL } from "../constants";

/**
 * `DEFAULT_MODEL` is derived from the model registry through the same tier
 * grammar as the `openai/latest` alias. The guarantees worth pinning: it is
 * exactly what the alias resolves to, the registry serves it, and it supports
 * structured outputs (the point of a modern default for prompts that return
 * strict JSON).
 */
describe("given the committed model catalog", () => {
  describe("when the platform default model is read", () => {
    /** @scenario The default prompt model is a current model the registry still serves */
    it("is a registry chat model with structured outputs", () => {
      const entry = getModelById(DEFAULT_MODEL);
      expect(
        entry,
        `${DEFAULT_MODEL} is not in the model registry`,
      ).toBeTruthy();
      expect(entry!.supportedParameters).toEqual(
        expect.arrayContaining(["response_format"]),
      );
      expect(DEFAULT_MODEL).not.toMatch(/^openai\/gpt-[0-4]([.-]|$)/);
    });

    /** @scenario The platform fallback model equals what OpenAI latest resolves to */
    it("equals the model openai/latest resolves to", () => {
      const latest = resolveLatestAlias("openai/latest");
      expect(latest, "registry has no openai main-tier model").toBeTruthy();
      expect(DEFAULT_MODEL).toBe(latest);
      expect(DEFAULT_MODEL).not.toBe("openai/gpt-5.5");
    });
  });
});
