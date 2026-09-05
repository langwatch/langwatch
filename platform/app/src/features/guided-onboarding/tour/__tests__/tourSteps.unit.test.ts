import { describe, expect, it, vi } from "vitest";
import { GOVERNANCE_SOURCES_ROUTE } from "../../landing";
import {
  BUILD_GROUP_ID,
  pathHasTour,
  readMs,
  TOUR_STEPS,
  TOUR_VIRTUAL_KEY_NAME,
  type TourStepContext,
} from "../tourSteps";

function ctx(): TourStepContext & {
  navigate: ReturnType<typeof vi.fn>;
  actions: Record<string, ReturnType<typeof vi.fn>>;
} {
  return {
    navigate: vi.fn(),
    actions: {
      expandGroup: vi.fn(),
      collapseGroup: vi.fn(),
      restoreGroups: vi.fn(),
      openVirtualKeyCreate: vi.fn(),
      typeVirtualKeyName: vi.fn(),
      submitVirtualKeyCreate: vi.fn(),
      revealVirtualKeySecret: vi.fn(),
    },
  };
}

describe("tour step tables", () => {
  describe("given the llmops tour", () => {
    /** @scenario the LLM Ops tour has four steps over the navigation */
    it("targets the sidebar, the Build group, the rail and the project switcher with the prototype's texts", () => {
      const steps = TOUR_STEPS.llmops;
      expect(steps.map((s) => s.target)).toEqual([
        "sidebar",
        "nav-group-build",
        "rail",
        "project-switcher",
      ]);
      expect(steps.map((s) => s.text)).toEqual([
        "This is the menu: everything you need to fully control your agent lives here.",
        "Here are your prompts, connected agents, evaluators, datasets and all the assets you need to improve your agent.",
        "This is where you switch to different areas of the product, like Gateway, Coding Agent Tracking and Governance.",
        "And this is how you change between projects, for different teams.",
      ]);
      expect(steps.map((s) => s.placement)).toEqual([
        "right",
        "right",
        "right",
        "bottom",
      ]);
    });

    /** @scenario Build folds before the first step and is restored at the end */
    it("folds Build before step 1 and the rail step, and opens it when the cursor lands on it", () => {
      const c = ctx();
      TOUR_STEPS.llmops[0]!.before?.(c);
      expect(c.actions.collapseGroup).toHaveBeenCalledWith(BUILD_GROUP_ID);
      TOUR_STEPS.llmops[1]!.onArrive?.(c);
      expect(c.actions.expandGroup).toHaveBeenCalledWith(BUILD_GROUP_ID);
      TOUR_STEPS.llmops[2]!.before?.(c);
      expect(c.actions.collapseGroup).toHaveBeenCalledTimes(2);
      expect(TOUR_STEPS.llmops[1]!.click).toBe(true);
    });
  });

  describe("given the gateway tour", () => {
    /** @scenario the gateway tour has five steps that mint a key named production-app */
    it("walks the nav item, the New key button, the name, Create and the secret", () => {
      const steps = TOUR_STEPS.gateway;
      expect(steps.map((s) => s.target)).toEqual([
        "nav-virtual-keys",
        "gw-new-key",
        "vk-name",
        "vk-create",
        "vk-secret",
      ]);
      expect(steps.map((s) => s.text)).toEqual([
        "Here you can see your virtual keys: scoped credentials with budgets and model allowlists.",
        "Let's create your first one right now.",
        "I'll name it for you.",
        "And create it.",
        "That's it! I will leave you to save it somewhere safe.",
      ]);
      expect(TOUR_VIRTUAL_KEY_NAME).toBe("production-app");
    });

    /** @scenario the gateway tour opens the real create drawer, types the name and submits it */
    it("drives the page through the registered actions", () => {
      const c = ctx();
      TOUR_STEPS.gateway[0]!.onArrive?.(c);
      expect(c.navigate).toHaveBeenCalledWith("/gateway/virtual-keys");
      TOUR_STEPS.gateway[1]!.onArrive?.(c);
      expect(c.actions.openVirtualKeyCreate).toHaveBeenCalled();
      TOUR_STEPS.gateway[2]!.onArrive?.(c);
      expect(c.actions.typeVirtualKeyName).toHaveBeenCalledWith(
        "production-app",
      );
      TOUR_STEPS.gateway[3]!.onArrive?.(c);
      expect(c.actions.submitVirtualKeyCreate).toHaveBeenCalled();
    });

    /** @scenario the secret step reveals the secret */
    it("reveals the secret on the last step", () => {
      const c = ctx();
      TOUR_STEPS.gateway[4]!.onArrive?.(c);
      expect(c.actions.revealVirtualKeySecret).toHaveBeenCalled();
    });
  });

  describe("given the governance tour", () => {
    /** @scenario the governance tour has two steps, the second on the sources page */
    it("shows the sidebar then navigates to the sources page", () => {
      const steps = TOUR_STEPS.governance;
      expect(steps.map((s) => s.target)).toEqual(["sidebar", "main-content"]);
      expect(steps.map((s) => s.text)).toEqual([
        "Everything here starts from your sources: billing exports, your identity provider, and the AI tools your teams already use.",
        "This is where you connect them. Start with your identity provider, then the vendor billing exports: I'll map every tool, seat and dollar from there.",
      ]);
      const c = ctx();
      steps[1]!.before?.(c);
      expect(c.navigate).toHaveBeenCalledWith(GOVERNANCE_SOURCES_ROUTE);
      expect(steps[1]!.placement).toBe("left");
    });
  });

  describe("given the coding path", () => {
    /** @scenario the coding path has no tour */
    it("has no steps and reports no tour", () => {
      expect(TOUR_STEPS.coding).toEqual([]);
      expect(pathHasTour("coding")).toBe(false);
      expect(pathHasTour("llmops")).toBe(true);
    });
  });

  describe("when a step's reading time is computed", () => {
    /** @scenario a step reads at three times a slow reading pace */
    it("is (2800 + words * 330) * 3", () => {
      expect(readMs("And create it.")).toBe((2800 + 3 * 330) * 3);
      expect(readMs("And create it.")).toBe(11370);
    });
  });
});
