/**
 * The fold-in migration converts rows stored under the retired
 * `google_agent_platform` provider into Gemini rows: field names change,
 * values and everything else on the row do not.
 *
 * Covers @unit scenarios from
 * specs/model-providers/google-agent-platform.feature.
 */
import { describe, expect, it } from "vitest";
import {
  foldAgentPlatformKeys,
  foldedRowName,
} from "../migrateAgentPlatformToGemini";

describe("foldAgentPlatformKeys", () => {
  describe("given an Agent Platform credential", () => {
    /** @scenario A stored Google Agent Platform row becomes a Gemini row with the same credential */
    it("preserves the key, project and location under the Gemini field names", () => {
      expect(
        foldAgentPlatformKeys({
          GOOGLE_AGENT_PLATFORM_API_KEY: "AQ.AnAgentPlatformKey",
          GOOGLE_AGENT_PLATFORM_PROJECT: "acme-123",
          GOOGLE_AGENT_PLATFORM_LOCATION: "us-central1",
        }),
      ).toEqual({
        GEMINI_API_KEY: "AQ.AnAgentPlatformKey",
        GEMINI_PROJECT: "acme-123",
        GEMINI_LOCATION: "us-central1",
      });
    });

    it("passes unknown fields through under their own names", () => {
      expect(
        foldAgentPlatformKeys({
          GOOGLE_AGENT_PLATFORM_API_KEY: "k",
          SOMETHING_ELSE: "kept",
        }),
      ).toEqual({ GEMINI_API_KEY: "k", SOMETHING_ELSE: "kept" });
    });
  });
});

describe("foldedRowName", () => {
  describe("given a row still wearing the retired provider's default name", () => {
    it("becomes Gemini when the organization has none", () => {
      expect(
        foldedRowName({
          currentName: "Google Agent Platform",
          takenNames: [],
        }),
      ).toBe("Gemini");
    });

    it("suffixes past existing Gemini rows, matching the create-time convention", () => {
      expect(
        foldedRowName({
          currentName: "Google Agent Platform",
          takenNames: ["Gemini", "Gemini 2"],
        }),
      ).toBe("Gemini 3");
    });
  });

  describe("given a customer-renamed row", () => {
    it("keeps the customer's name", () => {
      expect(
        foldedRowName({
          currentName: "Our Google account",
          takenNames: ["Gemini"],
        }),
      ).toBe("Our Google account");
    });
  });
});
