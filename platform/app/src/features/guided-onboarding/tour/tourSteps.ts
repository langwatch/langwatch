/**
 * The step tables of the guided tour, one per path, and the reading time
 * that paces them. Targets name `data-tour` attributes on the real product;
 * `before` and `onArrive` act on the page through the actions it registered
 * (see tourRegistry.ts) or by navigating.
 *
 * Framework-free: the tables are data, the layer that plays them is
 * TourLayer.tsx.
 *
 * @see specs/features/onboarding/guided-tour.feature
 */
import { GOVERNANCE_SOURCES_ROUTE } from "../landing";
import type { GuidedPath } from "../paths";
import type { TourActions } from "./tourRegistry";

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
  /** Runs when the step starts, before the cursor moves (navigate, collapse). */
  before?: (ctx: TourStepContext) => void;
  /** Runs when the cursor lands on the target (expand, open the drawer). */
  onArrive?: (ctx: TourStepContext) => void;
}

/** The sidebar section id of the Build group (`MainMenu.tsx`). */
export const BUILD_GROUP_ID = "library";

/** The name the gateway tour types for the user. */
export const TOUR_VIRTUAL_KEY_NAME = "production-app";

/** Three times a slow reading pace, in milliseconds. */
export function readMs(text: string): number {
  return (2800 + text.split(/\s+/).length * 330) * 3;
}

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
      onArrive: ({ actions }) =>
        actions.typeVirtualKeyName?.(TOUR_VIRTUAL_KEY_NAME),
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
  governance: [
    {
      target: "sidebar",
      text: "Everything here starts from your sources: billing exports, your identity provider, and the AI tools your teams already use.",
      placement: "right",
    },
    {
      target: "main-content",
      text: "This is where you connect them. Start with your identity provider, then the vendor billing exports: I'll map every tool, seat and dollar from there.",
      placement: "left",
      before: ({ navigate }) => navigate(GOVERNANCE_SOURCES_ROUTE),
    },
  ],
  coding: [],
};

export function pathHasTour(path: GuidedPath): boolean {
  return TOUR_STEPS[path].length > 0;
}
