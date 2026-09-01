/**
 * The automations family, as the browser application mounts it.
 *
 * ADR-004 makes a screen an owner-only export named after the frontend feature
 * that composes it, so the whole family is one entry. What it exposes is a
 * loader rather than a component, because the screen drags Monaco, the Liquid
 * templating module and five delivery providers behind it and none of that
 * belongs in the chunk that renders the rest of the application.
 *
 * ONE SCREEN, FIVE ADDRESSES. `/:project/automations` and its four tab URLs are
 * the same module — they always were, and `platform/app`'s loader registry said
 * so by pointing five keys at one import. The map from a page key to this
 * loader is `apps/ui`'s to make, and so is which of the four tabs a key shows:
 * the screen takes it as a prop rather than matching the pathname, which is a
 * screen reading the address to learn what the route table already knew. The
 * tab names travel with the loader so the mapping can be written in the
 * package's own vocabulary.
 *
 * WHAT THE OWNING FRONTEND FEATURE HAS TO MOUNT is two things: the tRPC
 * Provider this package's hooks run on, and the host port that answers for the
 * session, the scope, the address, the deployment's own URL and the toasts.
 */

import type { ComponentType } from "react";

export type AutomationScreenLoader = () => Promise<{ default: ComponentType }>;

export const automationScreens = {
  automations: () => import("./automations.screen"),
} as const satisfies Record<string, AutomationScreenLoader>;

export type AutomationScreenName = keyof typeof automationScreens;

export { AUTOMATION_SECTIONS, type AutomationSection } from "../../ui/sections/automations-layout";
export { automationApi } from "../../behavior/automation-api";
export {
  AutomationHostPort,
  AutomationHostProvider,
  type AutomationFailureNotice,
  type AutomationOrganization,
  type AutomationProject,
  type AutomationRouteReading,
  type AutomationScope,
  type AutomationSuccessNotice,
  type AutomationTeam,
} from "../../model/automation-host";
