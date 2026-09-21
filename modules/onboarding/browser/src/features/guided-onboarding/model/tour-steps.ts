/**
 * The step tables of the guided tour, one per path. Targets name `data-tour`
 * attributes; `before`/`onArrive` act through the registered actions or by
 * navigating. Framework-free: `ui/tour/tour-layer.tsx` is what plays them.
 * @see specs/features/onboarding/guided-tour.feature
 */
import type { GuidedPath } from "@langwatch/onboarding-contract";

import type { TourActions } from "./tour-actions.ts";

/**
 * Where the caption sits relative to the target. "auto" picks bottom for a
 * wide target and right for a tall one, for a target that is a pill in one
 * navigation mode and a full-height rail in the other.
 */
export type TourPlacement = "right" | "bottom" | "left" | "auto";

export interface TourStepContext {
  navigate: (to: string) => void;
  actions: Partial<TourActions>;
}

export interface TourStep {
  /** The `data-tour` value of the element the cursor lands on. */
  target: string;
  text: string;
  placement: TourPlacement;
  /** Show a click ripple when the cursor lands. */
  click?: boolean;
  /**
   * How long to wait for the target before skipping the step, when the
   * default is too short: a target that only exists once a request the
   * previous step fired has answered.
   */
  waitMs?: number;
  /**
   * Runs when the step starts, before the cursor moves (navigate, collapse).
   * A returned promise is work that answers later; the next step waits for
   * it before it gives up on its target.
   */
  before?: (ctx: TourStepContext) => void | Promise<unknown>;
  /** Runs when the cursor lands on the target (expand, open the drawer). Same promise rule. */
  onArrive?: (ctx: TourStepContext) => void | Promise<unknown>;
}

/** The sidebar section id of the Build group (`MainMenu`). */
export const BUILD_GROUP_ID = "library";

/** The name the gateway tour types for the user. */
export const TOUR_VIRTUAL_KEY_NAME = "production-app";

/** Three times a slow reading pace, in milliseconds. */
export function readMs(text: string): number {
  return (2800 + text.split(/\s+/).length * 330) * 3;
}

/** The governance pages the tour walks, in the order it walks them. */
export const GOVERNANCE_TOUR_ROUTES = {
  costs: "/governance/costs",
  agents: "/governance/agents",
  people: "/governance/people",
  inventory: "/governance/inventory",
} as const;

export const TOUR_STEPS: Record<GuidedPath, readonly TourStep[]> = {
  llmops: [
    {
      target: "sidebar",
      text: "This is the menu: everything you need to fully control your agent lives here.",
      placement: "right",
      before: ({ actions }) => actions.collapseGroup?.(BUILD_GROUP_ID),
    },
    {
      target: "nav-group-build",
      text: "Here are your prompts, connected agents, evaluators, datasets and all the assets you need to improve your agent.",
      placement: "right",
      click: true,
      onArrive: ({ actions }) => actions.expandGroup?.(BUILD_GROUP_ID),
    },
    {
      target: "product-switcher",
      text: "This is where you switch to different areas of the product, like Gateway, Coding Agent Tracking and Governance.",
      placement: "auto",
      before: ({ actions }) => actions.collapseGroup?.(BUILD_GROUP_ID),
    },
    {
      target: "project-switcher",
      text: "And this is how you change between projects, for different teams.",
      placement: "bottom",
    },
  ],
  gateway: [
    {
      target: "nav-virtual-keys",
      text: "Here you can see your virtual keys: scoped credentials with budgets and model allowlists.",
      placement: "right",
      click: true,
      onArrive: ({ navigate }) => navigate("/gateway/virtual-keys"),
    },
    {
      /* the drawer slides over this button, so it stays closed while the
         caption points at it and opens on the way to the name field */
      target: "gw-new-key",
      text: "Let's create your first one right now.",
      placement: "bottom",
      click: true,
    },
    {
      target: "vk-name",
      text: "I'll name it for you.",
      placement: "right",
      before: ({ actions }) => actions.openVirtualKeyCreate?.(),
      onArrive: ({ actions }) => actions.typeVirtualKeyName?.(TOUR_VIRTUAL_KEY_NAME),
    },
    {
      target: "vk-create",
      text: "And create it.",
      placement: "right",
      click: true,
      onArrive: ({ actions }) => actions.submitVirtualKeyCreate?.(),
    },
    {
      target: "vk-secret",
      text: "That's it! I will leave you to save it somewhere safe.",
      placement: "bottom",
      /* the secret only exists once the create request has answered */
      waitMs: 15_000,
      onArrive: ({ actions }) => actions.revealVirtualKeySecret?.(),
    },
  ],
  /* every page step turns the sample panels on before it navigates, so the
     page mounts with its sample data in place; the end action below turns
     them off, whichever way the tour ends */
  governance: [
    {
      target: "gov-cost-over-time",
      text: "Costs: what your organization spends on AI over time, from vendor billing and the gateway.",
      placement: "auto",
      before: ({ navigate, actions }) => {
        actions.showSampleData?.();
        navigate(GOVERNANCE_TOUR_ROUTES.costs);
      },
    },
    {
      target: "gov-cost-by-department",
      text: "And where it goes: by department, by model and by agent.",
      placement: "auto",
      before: ({ actions }) => actions.showSampleData?.(),
    },
    {
      target: "gov-agents",
      text: "Agents: every agent your teams run, who owns it and what it costs.",
      placement: "auto",
      before: ({ navigate, actions }) => {
        actions.showSampleData?.();
        navigate(GOVERNANCE_TOUR_ROUTES.agents);
      },
    },
    {
      target: "gov-people",
      text: "People: who uses which tools, by department, from your identity provider.",
      placement: "auto",
      before: ({ navigate, actions }) => {
        actions.showSampleData?.();
        navigate(GOVERNANCE_TOUR_ROUTES.people);
      },
    },
    {
      target: "gov-inventory",
      text: "Inventory: the tools, the environments they run in and the sources behind them.",
      placement: "auto",
      before: ({ navigate, actions }) => {
        actions.showSampleData?.();
        navigate(GOVERNANCE_TOUR_ROUTES.inventory);
      },
    },
    {
      /* the menu stays open when the tour ends: it is the last thing the
         demo shows */
      target: "gov-add-source",
      text: "It all starts here: connect an identity provider, a billing export or a tool's admin API.",
      placement: "right",
      click: true,
      onArrive: ({ actions }) => actions.openAddSourceMenu?.(),
    },
  ],
  coding: [],
};

/**
 * What a path puts back when its tour ends: the governance tour turns the
 * sample panels off, the others change nothing they need to undo here.
 */
export const TOUR_END_ACTIONS: Partial<Record<GuidedPath, (ctx: TourStepContext) => void>> = {
  governance: ({ actions }) => actions.hideSampleData?.(),
};

export function pathHasTour(path: GuidedPath): boolean {
  return TOUR_STEPS[path].length > 0;
}
