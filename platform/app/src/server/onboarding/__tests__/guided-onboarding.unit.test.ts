/**
 * @vitest-environment node
 *
 * The guided onboarding path enum, the sign-up data schema it extends, and
 * how a stored value reads back.
 *
 * @see specs/features/onboarding/guided-onboarding-variant.feature
 */
import { describe, expect, it } from "vitest";
import {
  GUIDED_PATH_TITLES,
  GUIDED_PATHS,
  isGuidedPath,
} from "~/features/guided-onboarding/paths";
import {
  EMPTY_GUIDED_ONBOARDING_STATE,
  signUpDataSchema,
} from "~/server/schemas/sign-up-data.schema";
import {
  parseGuidedOnboardingState,
  parseOnboardingVariant,
} from "../guided-onboarding.service";

describe("the guided paths", () => {
  /** @scenario "the guided path enum carries the four paths with their titles" */
  it("are llmops, coding, gateway and governance with their titles", () => {
    expect(GUIDED_PATHS).toEqual(["llmops", "coding", "gateway", "governance"]);
    expect(GUIDED_PATH_TITLES).toEqual({
      llmops: "Evals & LLM Ops",
      coding: "Coding Agent Tracking",
      gateway: "Gateway",
      governance: "Governance",
    });
    expect(isGuidedPath("gateway")).toBe(true);
    expect(isGuidedPath("billing")).toBe(false);
  });
});

describe("the sign-up data schema", () => {
  describe("when it carries an onboarding variant and a guided block", () => {
    /** @scenario "the sign-up data schema accepts the onboarding variant and the guided state" */
    it("parses and keeps the paths in order", () => {
      const parsed = signUpDataSchema.parse({
        companyType: "company",
        onboardingVariant: "guided",
        guidedOnboarding: {
          paths: ["gateway", "llmops"],
          currentPath: "gateway",
          donePaths: [],
          provider: "openai",
          providerModel: "gpt-5",
        },
      });

      expect(parsed.onboardingVariant).toBe("guided");
      expect(parsed.guidedOnboarding?.paths).toEqual(["gateway", "llmops"]);
      expect(parsed.guidedOnboarding?.currentPath).toBe("gateway");
    });

    it("rejects a path outside the four", () => {
      const result = signUpDataSchema.safeParse({
        guidedOnboarding: { paths: ["billing"], donePaths: [] },
      });
      expect(result.success).toBe(false);
    });
  });

  describe("when it carries neither", () => {
    it("still parses the classic sign-up answers", () => {
      const parsed = signUpDataSchema.parse({ companyType: "company" });
      expect(parsed.onboardingVariant).toBeUndefined();
      expect(parsed.guidedOnboarding).toBeUndefined();
    });
  });
});

describe("reading the guided state off a stored organization", () => {
  describe("when the stored block is not the expected shape", () => {
    /** @scenario "a malformed guided state on the organization reads as the empty default" */
    it("reads as the empty default instead of an error", () => {
      expect(
        parseGuidedOnboardingState({ guidedOnboarding: "not an object" }),
      ).toEqual(EMPTY_GUIDED_ONBOARDING_STATE);
      expect(
        parseGuidedOnboardingState({
          guidedOnboarding: { paths: ["billing"], donePaths: [] },
        }),
      ).toEqual(EMPTY_GUIDED_ONBOARDING_STATE);
      expect(parseGuidedOnboardingState(null)).toEqual(
        EMPTY_GUIDED_ONBOARDING_STATE,
      );
      expect(parseGuidedOnboardingState("text")).toEqual(
        EMPTY_GUIDED_ONBOARDING_STATE,
      );
    });
  });

  describe("when the stored block is well formed", () => {
    it("reads it back with the defaults filled in", () => {
      expect(
        parseGuidedOnboardingState({
          guidedOnboarding: { paths: ["coding"], conversationId: "conv_1" },
        }),
      ).toEqual({ paths: ["coding"], donePaths: [], conversationId: "conv_1" });
    });
  });

  describe("when the variant is read", () => {
    it("answers guided, classic, or null for anything else", () => {
      expect(parseOnboardingVariant({ onboardingVariant: "guided" })).toBe(
        "guided",
      );
      expect(parseOnboardingVariant({ onboardingVariant: "classic" })).toBe(
        "classic",
      );
      expect(parseOnboardingVariant({ onboardingVariant: "other" })).toBeNull();
      expect(parseOnboardingVariant(null)).toBeNull();
    });
  });
});
