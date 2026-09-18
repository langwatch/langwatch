/**
 * Scope/permission reads from platform hooks (without landing policy); feature
 * flags keep two-field answer for prefill cases that depend on flag state.
 */

import { useMemo } from "react";
import {
  useAutomationHost,
  type AutomationOrganization,
  type AutomationProject,
  type AutomationTeam,
} from "../model/automation-host.ts";

export type AutomationScopeReading = {
  organization: AutomationOrganization | undefined;
  project: AutomationProject | undefined;
  team: AutomationTeam | undefined;
  hasPermission: (permission: string) => boolean;
};

export function useOrganizationTeamProject(): AutomationScopeReading {
  const host = useAutomationHost();
  return useMemo(
    () => ({
      organization: host.organization(),
      project: host.project(),
      team: host.team(),
      hasPermission: (permission: string) => host.hasPermission(permission),
    }),
    [host],
  );
}

export type AutomationFeatureFlagReading = {
  enabled: boolean;
  isLoading: boolean;
};

/** Fails closed while the answer is in flight, and says that it is. */
export function useFeatureFlag(flag: string): AutomationFeatureFlagReading {
  const host = useAutomationHost();
  const answer = host.featureFlag(flag);
  return { enabled: answer === true, isLoading: answer === void 0 };
}

/** This application's own address, for the links a rendered preview prints. */
export function useAppBaseUrl(): string {
  return useAutomationHost().appBaseUrl();
}
