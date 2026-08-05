/**
 * @vitest-environment node
 *
 * The two provider-resolution failures carry stable codes.
 *
 * Both were plain `Error`s whose message held the remediation sentence, so a
 * knowable, actionable failure reached customers as the generic unknown state
 * and the words lived in a thrown string instead of the presentation registry.
 * Assertions are on `code`, never on the prose, which is copy and will change.
 */
import { HandledError } from "@langwatch/handled-error";
import { describe, expect, it } from "vitest";
import {
  ModelProviderNotConfiguredError,
  ModelProviderNotEnabledError,
} from "../errors";

describe("provider resolution errors", () => {
  describe("given the resolved model names a provider the project never set up", () => {
    const error = new ModelProviderNotConfiguredError("azure");

    it("is a handled error, so the boundary keeps its code instead of degrading to unknown", () => {
      expect(HandledError.isHandled(error)).toBe(true);
    });

    it("carries the missing_provider code", () => {
      expect(error.code).toBe("missing_provider");
    });

    it("carries the provider key as a fact the client can render", () => {
      expect(error.meta).toMatchObject({ providerKey: "azure" });
    });

    it("blames the customer's configuration rather than the platform", () => {
      expect(error.fault).toBe("customer");
    });

    it("keeps remediation copy out of the message", () => {
      // The registry owns "go and add one"; a sentence here would be a second
      // source of truth that drifts from it.
      expect(error.message).not.toMatch(/settings/i);
    });
  });

  describe("given the provider exists but is switched off", () => {
    const error = new ModelProviderNotEnabledError("openai_codex");

    it("is a handled error", () => {
      expect(HandledError.isHandled(error)).toBe(true);
    });

    it("carries the model_provider_disabled code", () => {
      expect(error.code).toBe("model_provider_disabled");
    });

    it("carries the provider key", () => {
      expect(error.meta).toMatchObject({ providerKey: "openai_codex" });
    });

    it("keeps remediation copy out of the message", () => {
      expect(error.message).not.toMatch(/settings/i);
    });
  });
});
