import { describe, expect, it } from "vitest";
import {
  buildOnboardingSteps,
  calculateCompletionPercentage,
} from "../OnboardingProgress";

const defaultData = {
  workflows: 0,
  datasets: 0,
  evaluations: 0,
  simulations: 0,
  modelProviders: 0,
  prompts: 0,
  teamMembers: 1,
  firstMessage: false,
};

describe("OnboardingProgress", () => {
  describe("buildOnboardingSteps", () => {
    describe("when building steps from API data", () => {
      it("marks createProject as always complete", () => {
        const steps = buildOnboardingSteps(defaultData, "test-project");

        expect(steps[0]?.complete).toBe(true);
        expect(steps[0]?.key).toBe("createProject");
      });

      it("marks syncFirstMessage complete when firstMessage is true", () => {
        const steps = buildOnboardingSteps(
          { ...defaultData, firstMessage: true },
          "test-project",
        );

        expect(steps[1]?.complete).toBe(true);
        expect(steps[1]?.key).toBe("syncFirstMessage");
      });

      it("marks syncFirstMessage incomplete when firstMessage is false", () => {
        const steps = buildOnboardingSteps(defaultData, "test-project");

        expect(steps[1]?.complete).toBe(false);
      });

      it("marks inviteTeamMembers complete when teamMembers > 1", () => {
        const steps = buildOnboardingSteps(
          { ...defaultData, teamMembers: 2 },
          "test-project",
        );

        expect(steps[2]?.complete).toBe(true);
        expect(steps[2]?.key).toBe("inviteTeamMembers");
      });

      it("marks inviteTeamMembers incomplete when teamMembers is 1", () => {
        const steps = buildOnboardingSteps(
          { ...defaultData, teamMembers: 1 },
          "test-project",
        );

        expect(steps[2]?.complete).toBe(false);
      });

      it("marks setupModelProviders complete when modelProviders > 0", () => {
        const steps = buildOnboardingSteps(
          { ...defaultData, modelProviders: 1 },
          "test-project",
        );

        expect(steps[3]?.complete).toBe(true);
        expect(steps[3]?.key).toBe("setupModelProviders");
      });

      it("marks createPrompt complete when prompts > 0", () => {
        const steps = buildOnboardingSteps(
          { ...defaultData, prompts: 1 },
          "test-project",
        );

        expect(steps[4]?.complete).toBe(true);
        expect(steps[4]?.key).toBe("createPrompt");
      });

      it("marks createSimulation complete when simulations > 0", () => {
        const steps = buildOnboardingSteps(
          { ...defaultData, simulations: 1 },
          "test-project",
        );

        expect(steps[5]?.complete).toBe(true);
        expect(steps[5]?.key).toBe("createSimulation");
      });

      it("marks setupEvaluation complete when evaluations > 0", () => {
        const steps = buildOnboardingSteps(
          { ...defaultData, evaluations: 1 },
          "test-project",
        );

        expect(steps[6]?.complete).toBe(true);
        expect(steps[6]?.key).toBe("setupEvaluation");
      });

      it("marks createWorkflow complete when workflows > 0", () => {
        const steps = buildOnboardingSteps(
          { ...defaultData, workflows: 1 },
          "test-project",
        );

        expect(steps[7]?.complete).toBe(true);
        expect(steps[7]?.key).toBe("createWorkflow");
      });

      it("marks createDataset complete when datasets > 0", () => {
        const steps = buildOnboardingSteps(
          { ...defaultData, datasets: 1 },
          "test-project",
        );

        expect(steps[8]?.complete).toBe(true);
        expect(steps[8]?.key).toBe("createDataset");
      });

      it("generates correct hrefs with project slug", () => {
        const steps = buildOnboardingSteps(defaultData, "my-project");

        expect(steps[1]?.href).toBe("/my-project/messages");
        expect(steps[4]?.href).toBe("/my-project/prompts");
        expect(steps[7]?.href).toBe("/my-project/workflows");
      });
    });
  });

  describe("calculateCompletionPercentage", () => {
    describe("when calculating completion percentage", () => {
      it("returns 11 when only createProject is complete (1/9)", () => {
        const steps = buildOnboardingSteps(defaultData, "test-project");

        expect(calculateCompletionPercentage(steps)).toBe(11);
      });

      it("returns 44 when 4 of 9 steps complete", () => {
        const steps = buildOnboardingSteps(
          {
            ...defaultData,
            modelProviders: 1,
            prompts: 1,
            firstMessage: true,
          },
          "test-project",
        );

        expect(calculateCompletionPercentage(steps)).toBe(44);
      });

      it("returns 100 when all steps complete", () => {
        const steps = buildOnboardingSteps(
          {
            workflows: 1,
            datasets: 1,
            evaluations: 1,
            simulations: 1,
            modelProviders: 1,
            prompts: 1,
            teamMembers: 2,
            firstMessage: true,
          },
          "test-project",
        );

        expect(calculateCompletionPercentage(steps)).toBe(100);
      });
    });
  });
});
