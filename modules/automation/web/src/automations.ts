/**
 * Automations family: lazy-loaded screen (Monaco, Liquid templating) with
 * five-URL mapping managed by host package per ADR-004 owner-only exports.
 */

import type { ComponentType } from "react";

export type AutomationScreenLoader = () => Promise<{ default: ComponentType }>;

export const automationScreens = {
  automations: () => import("./ui/sections/automations-screen.tsx"),
} as const satisfies Record<string, AutomationScreenLoader>;

export type AutomationScreenName = keyof typeof automationScreens;

export { AUTOMATION_SECTIONS, type AutomationSection } from "./ui/sections/automations-layout.tsx";
export { automationApi } from "./behavior/automation-api.ts";
export {
  AutomationHost,
  AutomationHostProvider,
  type AutomationDatasetCreation,
  type AutomationDrawer,
  type AutomationFailureNotice,
  type AutomationOrganization,
  type AutomationProject,
  type AutomationRouteReading,
  type AutomationScope,
  type AutomationSuccessNotice,
  type AutomationTeam,
} from "./model/automation-host.ts";

/**
 * Unsubscribe landing page: token-only authorization per ADR-031, no session/
 * scope/host/chrome/page-guard (token is the only authorization needed).
 */
export type UnsubscribeScreenLoader = () => Promise<{
  default: ComponentType<{ token: string }>;
}>;

export const unsubscribeScreens = {
  unsubscribe: () => import("./ui/sections/unsubscribe-screen.tsx"),
} as const satisfies Record<string, UnsubscribeScreenLoader>;

export type UnsubscribeScreenName = keyof typeof unsubscribeScreens;

export type { UnsubscribeScope } from "./ui/sections/unsubscribe-screen.tsx";
