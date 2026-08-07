/**
 * The refusal a retired provider hands back is only actionable if the
 * customer is told what to add instead. That name comes from two places
 * that nothing joins: `deprecated.replacedBy` in the provider registry,
 * and the slug -> brand-name table in `presentation.ts`. A slug present
 * in one and missing from the other degrades silently to a sentence that
 * omits the name — safe, but the customer is left without the one fact
 * the error exists to give them.
 *
 * Covers @unit scenario from
 * specs/model-providers/google-agent-platform.feature.
 */
import { describe, expect, it } from "vitest";
import {
  modelProviders,
  providerDeprecation,
} from "../../../../server/modelProviders/registry";
import { explainHandledError } from "../presentation";

const describeRefusal = (provider: string, replacement: string) =>
  explainHandledError({
    code: "model_provider_deprecated",
    message: "This model provider is no longer available to add.",
    meta: { provider, replacement },
    fault: "customer",
  } as Parameters<typeof explainHandledError>[0]).description;

const UNNAMED = describeRefusal("whatever", "a-slug-with-no-entry");

describe("the copy a retired provider's refusal renders", () => {
  const deprecated = Object.keys(modelProviders)
    .map((provider) => ({
      provider,
      replacedBy: providerDeprecation(provider)?.replacedBy,
    }))
    .filter(
      (entry): entry is { provider: string; replacedBy: string } =>
        !!entry.replacedBy,
    );

  describe("given the registry retires a provider", () => {
    it.each(deprecated)("names the replacement for $provider", ({
      provider,
      replacedBy,
    }) => {
      expect(describeRefusal(provider, replacedBy)).not.toBe(UNNAMED);
    });
  });

  describe("given a replacement nothing has copy for", () => {
    /** @scenario The retired provider accepts no new credentials, from anywhere */
    it("still says the provider moved, without printing a raw slug", () => {
      expect(UNNAMED).not.toContain("a-slug-with-no-entry");
      expect(UNNAMED).toContain("Providers you already set up keep working.");
    });
  });
});
