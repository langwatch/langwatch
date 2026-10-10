import { describe, expect, it, type Mock, vi } from "vitest";

import {
  BUILD_GROUP_ID,
  GOVERNANCE_TOUR_ROUTES,
  pathHasTour,
  readMs,
  TOUR_END_ACTIONS,
  TOUR_STEPS,
  TOUR_VIRTUAL_KEY_NAME,
  type TourStepContext,
} from "../tour-steps.ts";

function ctx(): TourStepContext & {
  navigate: Mock<(to: string) => void>;
  actions: Record<string, ReturnType<typeof vi.fn>>;
} {
  return {
    navigate: vi.fn<(to: string) => void>(),
    actions: {
      expandGroup: vi.fn(),
      collapseGroup: vi.fn(),
      restoreGroups: vi.fn(),
      openVirtualKeyCreate: vi.fn(),
      typeVirtualKeyName: vi.fn(),
      submitVirtualKeyCreate: vi.fn(),
      revealVirtualKeySecret: vi.fn(),
      showSampleData: vi.fn(),
      hideSampleData: vi.fn(),
      openAddSourceMenu: vi.fn(),
    },
  };
}

describe("tour step tables", () => {
  describe("given the llmops tour", () => {
    /** @scenario the LLM Ops tour has four steps over the navigation */
    it("targets the sidebar, the Build group, the product switcher and the project switcher with the prototype's texts", () => {
      const steps = TOUR_STEPS.llmops;
      expect(steps.map((s) => s.target)).toEqual([
        "sidebar",
        "nav-group-build",
        "product-switcher",
        "project-switcher",
      ]);
      expect(steps.map((s) => s.text)).toEqual([
        "This is the menu: everything you need to fully control your agent lives here.",
        "Here are your prompts, connected agents, evaluators, datasets and all the assets you need to improve your agent.",
        "This is where you switch to different areas of the product, like Gateway, Coding Agent Tracking and Governance.",
        "And this is how you change between projects, for different teams.",
      ]);
      expect(steps.map((s) => s.placement)).toEqual(["right", "right", "auto", "bottom"]);
    });

    /** @scenario Build folds before the first step and is restored at the end */
    it("folds Build before step 1 and the product switcher step, and opens it when the cursor lands on it", () => {
      const c = ctx();
      void TOUR_STEPS.llmops[0]!.before?.(c);
      expect(c.actions.collapseGroup).toHaveBeenCalledWith(BUILD_GROUP_ID);
      void TOUR_STEPS.llmops[1]!.onArrive?.(c);
      expect(c.actions.expandGroup).toHaveBeenCalledWith(BUILD_GROUP_ID);
      void TOUR_STEPS.llmops[2]!.before?.(c);
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
      void TOUR_STEPS.gateway[0]!.onArrive?.(c);
      expect(c.navigate).toHaveBeenCalledWith("/gateway/virtual-keys");
      void TOUR_STEPS.gateway[1]!.onArrive?.(c);
      expect(c.actions.openVirtualKeyCreate).not.toHaveBeenCalled();
      void TOUR_STEPS.gateway[2]!.before?.(c);
      expect(c.actions.openVirtualKeyCreate).toHaveBeenCalled();
      void TOUR_STEPS.gateway[2]!.onArrive?.(c);
      expect(c.actions.typeVirtualKeyName).toHaveBeenCalledWith("production-app");
      void TOUR_STEPS.gateway[3]!.onArrive?.(c);
      expect(c.actions.submitVirtualKeyCreate).toHaveBeenCalled();
    });

    /** @scenario the secret step reveals the secret */
    it("waits for the key to be created, then reveals the secret", () => {
      const c = ctx();
      expect(TOUR_STEPS.gateway[4]!.waitMs).toBe(15_000);
      void TOUR_STEPS.gateway[4]!.onArrive?.(c);
      expect(c.actions.revealVirtualKeySecret).toHaveBeenCalled();
    });
  });

  describe("given the governance tour", () => {
    /** @scenario the governance tour walks Costs, Agents, People and Inventory and ends on the Add source menu */
    it("walks two cost graphs, the agents, the people and the inventory, then the Add source button", () => {
      const steps = TOUR_STEPS.governance;
      expect(steps.map((s) => s.target)).toEqual([
        "gov-cost-over-time",
        "gov-cost-by-department",
        "gov-agents",
        "gov-people",
        "gov-inventory",
        "gov-add-source",
      ]);
      expect(steps.map((s) => s.text)).toEqual([
        "Costs: what your organization spends on AI over time, from vendor billing and the gateway.",
        "And where it goes: by department, by model and by agent.",
        "Agents: every agent your teams run, who owns it and what it costs.",
        "People: who uses which tools, by department, from your identity provider.",
        "Inventory: the tools, the environments they run in and the sources behind them.",
        "It all starts here: connect an identity provider, a billing export or a tool's admin API.",
      ]);
    });

    /** @scenario the governance tour walks Costs, Agents, People and Inventory and ends on the Add source menu */
    it("navigates to each page before its first step, in order", () => {
      const c = ctx();
      for (const step of TOUR_STEPS.governance) void step.before?.(c);
      expect(c.navigate.mock.calls.map(([to]) => to)).toEqual([
        GOVERNANCE_TOUR_ROUTES.costs,
        GOVERNANCE_TOUR_ROUTES.agents,
        GOVERNANCE_TOUR_ROUTES.people,
        GOVERNANCE_TOUR_ROUTES.inventory,
      ]);
    });

    /** @scenario the governance tour ends with the Add source menu open */
    it("opens the Add source menu when the cursor lands on the last step, with a click", () => {
      const c = ctx();
      const last = TOUR_STEPS.governance.at(-1)!;
      expect(last.click).toBe(true);
      void last.onArrive?.(c);
      expect(c.actions.openAddSourceMenu).toHaveBeenCalledTimes(1);
      expect(c.navigate).not.toHaveBeenCalled();
    });

    /** @scenario the governance tour shows sample data on every page it visits and turns it off when it ends */
    it("turns the sample panels on before every page step and off in its end action", () => {
      const c = ctx();
      for (const step of TOUR_STEPS.governance) void step.before?.(c);
      expect(c.actions.showSampleData).toHaveBeenCalledTimes(5);
      expect(c.actions.hideSampleData).not.toHaveBeenCalled();
      TOUR_END_ACTIONS.governance?.(c);
      expect(c.actions.hideSampleData).toHaveBeenCalledTimes(1);
      expect(TOUR_END_ACTIONS.llmops).toBeUndefined();
      expect(TOUR_END_ACTIONS.gateway).toBeUndefined();
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
