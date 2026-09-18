/**
 * Automations family: lazy-loaded screen (Monaco, Liquid templating) with
 * five-URL mapping managed by host package per ADR-004 owner-only exports.
 */

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

export type { UnsubscribeScope } from "./ui/sections/unsubscribe-screen.tsx";
