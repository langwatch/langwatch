import { describe, expect, it } from "vitest";
import { getOnboardingFlowConfig } from "./onboarding-flow";
import { OnboardingScreenIndex } from "../types/types";

/**
 * ADR-038 I3/I7: the flow config IS the fork. Governance track is exactly
 * two screens; LLMOps keeps today's screens after the intent; self-hosted
 * gets the intent screen too.
 *
 * Spec: specs/features/onboarding/intent-fork.feature
 */
describe("getOnboardingFlowConfig", () => {
  describe("when on SaaS with no intent selected yet", () => {
    it("takes the LLMOps shape so the intent screen is never the final step before a choice exists", () => {
      const flow = getOnboardingFlowConfig(true, undefined);
      expect(flow.visibleScreens).toEqual([
        OnboardingScreenIndex.ORGANIZATION,
        OnboardingScreenIndex.INTENT,
        OnboardingScreenIndex.BASIC_INFO,
        OnboardingScreenIndex.DESIRES,
        OnboardingScreenIndex.ROLE,
      ]);
      expect(flow.last).not.toBe(OnboardingScreenIndex.INTENT);
    });

    it("places the intent screen second, right after the organization screen", () => {
      const flow = getOnboardingFlowConfig(true, undefined);
      expect(flow.visibleScreens[1]).toBe(OnboardingScreenIndex.INTENT);
    });
  });

  describe("when the LLMOps intent is selected on SaaS", () => {
    it("keeps today's screens in today's order after the intent screen (I2)", () => {
      const flow = getOnboardingFlowConfig(true, "LLM_OPS");
      expect(flow.visibleScreens).toEqual([
        OnboardingScreenIndex.ORGANIZATION,
        OnboardingScreenIndex.INTENT,
        OnboardingScreenIndex.BASIC_INFO,
        OnboardingScreenIndex.DESIRES,
        OnboardingScreenIndex.ROLE,
      ]);
      expect(flow.variant).toBe("full");
      expect(flow.total).toBe(5);
    });
  });

  describe("when the governance intent is selected on SaaS", () => {
    it("ends the track at the intent screen — two screens, no LLMOps questions, no CLI screen (I3)", () => {
      const flow = getOnboardingFlowConfig(true, "AGENT_GOVERNANCE");
      expect(flow.visibleScreens).toEqual([
        OnboardingScreenIndex.ORGANIZATION,
        OnboardingScreenIndex.INTENT,
      ]);
      expect(flow.total).toBe(2);
      expect(flow.last).toBe(OnboardingScreenIndex.INTENT);
    });
  });

  describe("when self-hosted (I7)", () => {
    it("includes the intent screen after the organization screen", () => {
      const flow = getOnboardingFlowConfig(false, undefined);
      expect(flow.visibleScreens).toEqual([
        OnboardingScreenIndex.ORGANIZATION,
        OnboardingScreenIndex.INTENT,
      ]);
      expect(flow.variant).toBe("self_hosted");
    });

    it("keeps the same two screens regardless of the selected intent", () => {
      expect(
        getOnboardingFlowConfig(false, "AGENT_GOVERNANCE").visibleScreens,
      ).toEqual([
        OnboardingScreenIndex.ORGANIZATION,
        OnboardingScreenIndex.INTENT,
      ]);
      expect(getOnboardingFlowConfig(false, "LLM_OPS").visibleScreens).toEqual([
        OnboardingScreenIndex.ORGANIZATION,
        OnboardingScreenIndex.INTENT,
      ]);
    });
  });
});
