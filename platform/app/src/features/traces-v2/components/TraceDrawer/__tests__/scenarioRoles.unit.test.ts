/**
 * @vitest-environment node
 *
 * The scenario role swap normally renders a run's "user" side as the LLM "User
 * Simulator". On a voice "Call it myself" run the caller is a real person, so
 * their turns read as "You" instead (#8020, decision 5).
 *
 * @see specs/features/agents/voice-agents-v1.feature
 */
import { describe, expect, it } from "vitest";
import { getDisplayRoleVisuals } from "../scenarioRoles";

describe("getDisplayRoleVisuals", () => {
  describe("given a scenario run", () => {
    describe("when the user turn is an LLM user-simulator", () => {
      it("labels it User Simulator", () => {
        const visuals = getDisplayRoleVisuals("user", { isScenario: true });

        expect(visuals.label).toBe("USER SIMULATOR");
        expect(visuals.bubbleLabel).toBe("User Simulator");
      });
    });

    describe("when the user turn is a real human caller", () => {
      /** @scenario "A human caller's turns render as You, not User Simulator" */
      it("labels it You with a person icon, not a flask", () => {
        const simulator = getDisplayRoleVisuals("user", { isScenario: true });
        const human = getDisplayRoleVisuals("user", {
          isScenario: true,
          isHumanCaller: true,
        });

        expect(human.label).toBe("YOU");
        expect(human.bubbleLabel).toBe("You");
        // A different icon than the flask the simulator carries.
        expect(human.Icon).not.toBe(simulator.Icon);
      });

      it("does not relabel the agent side", () => {
        const agent = getDisplayRoleVisuals("assistant", {
          isScenario: true,
          isHumanCaller: true,
        });

        expect(agent.bubbleLabel).toBe("Agent");
      });
    });
  });

  describe("given a non-scenario trace", () => {
    it("ignores the human-caller flag and keeps the plain User label", () => {
      const visuals = getDisplayRoleVisuals("user", {
        isScenario: false,
        isHumanCaller: true,
      });

      expect(visuals.bubbleLabel).toBe("User");
    });
  });
});
