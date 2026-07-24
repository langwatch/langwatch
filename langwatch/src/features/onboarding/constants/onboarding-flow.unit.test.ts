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
      const flow = getOnboardingFlowConfig({ isSaaS: true, intent: undefined, intentForkEnabled: true });
      expect(flow.visibleScreens).toEqual([
        OnboardingScreenIndex.ORGANIZATION,
        OnboardingScreenIndex.INTENT,
        OnboardingScreenIndex.BASIC_INFO,
        OnboardingScreenIndex.DESIRES,
        OnboardingScreenIndex.ROLE,
      ]);
      expect(flow.last).not.toBe(OnboardingScreenIndex.INTENT);
    });

    /** @scenario "Intent screen appears as the second step" */
    it("places the intent screen second, right after the organization screen", () => {
      const flow = getOnboardingFlowConfig({ isSaaS: true, intent: undefined, intentForkEnabled: true });
      expect(flow.visibleScreens[1]).toBe(OnboardingScreenIndex.INTENT);
    });
  });

  describe("when the LLMOps intent is selected on SaaS", () => {
    /** @scenario "LLMOps track keeps today's screens in today's order" */
    it("keeps today's screens in today's order after the intent screen (I2)", () => {
      const flow = getOnboardingFlowConfig({ isSaaS: true, intent: "LLM_OPS", intentForkEnabled: true });
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
    /** @scenario "Governance track has no screens after the intent" */
    it("ends the track at the intent screen — two screens, no LLMOps questions, no CLI screen (I3)", () => {
      const flow = getOnboardingFlowConfig({ isSaaS: true, intent: "AGENT_GOVERNANCE", intentForkEnabled: true });
      expect(flow.visibleScreens).toEqual([
        OnboardingScreenIndex.ORGANIZATION,
        OnboardingScreenIndex.INTENT,
      ]);
      expect(flow.total).toBe(2);
      expect(flow.last).toBe(OnboardingScreenIndex.INTENT);
    });
  });

  describe("when the governance flag is off (ADR-038 v5: ships dark)", () => {
    /** @scenario "With the fork disabled the flow is exactly the pre-fork one" */
    it("returns the exact pre-fork SaaS flow with no intent screen", () => {
      const flow = getOnboardingFlowConfig({ isSaaS: true, intent: undefined, intentForkEnabled: false });
      expect(flow.visibleScreens).toEqual([
        OnboardingScreenIndex.ORGANIZATION,
        OnboardingScreenIndex.BASIC_INFO,
        OnboardingScreenIndex.DESIRES,
        OnboardingScreenIndex.ROLE,
      ]);
      expect(flow.total).toBe(4);
    });

    it("returns the exact pre-fork single-screen self-hosted flow", () => {
      const flow = getOnboardingFlowConfig({ isSaaS: false, intent: undefined, intentForkEnabled: false });
      expect(flow.visibleScreens).toEqual([
        OnboardingScreenIndex.ORGANIZATION,
      ]);
      expect(flow.total).toBe(1);
    });

    it("ignores a selected intent while disabled", () => {
      expect(
        getOnboardingFlowConfig({ isSaaS: true, intent: "AGENT_GOVERNANCE", intentForkEnabled: false }).visibleScreens,
      ).not.toContain(OnboardingScreenIndex.INTENT);
    });
  });

  describe("when self-hosted (I7)", () => {
    /** @scenario "Self-hosted welcome includes the intent screen" */
    it("includes the intent screen after the organization screen", () => {
      const flow = getOnboardingFlowConfig({ isSaaS: false, intent: undefined, intentForkEnabled: true });
      expect(flow.visibleScreens).toEqual([
        OnboardingScreenIndex.ORGANIZATION,
        OnboardingScreenIndex.INTENT,
      ]);
      expect(flow.variant).toBe("self_hosted");
    });

    it("keeps the same two screens regardless of the selected intent", () => {
      expect(
        getOnboardingFlowConfig({ isSaaS: false, intent: "AGENT_GOVERNANCE", intentForkEnabled: true }).visibleScreens,
      ).toEqual([
        OnboardingScreenIndex.ORGANIZATION,
        OnboardingScreenIndex.INTENT,
      ]);
      expect(getOnboardingFlowConfig({ isSaaS: false, intent: "LLM_OPS", intentForkEnabled: true }).visibleScreens).toEqual([
        OnboardingScreenIndex.ORGANIZATION,
        OnboardingScreenIndex.INTENT,
      ]);
    });
  });
});
