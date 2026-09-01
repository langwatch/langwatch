/**
 * The reads the automations screen used to get from `useOrganizationTeamProject`
 * and `useFeatureFlag`.
 *
 * The platform hook resolved the active scope AND redirected on it: a reader
 * without a project was bounced to onboarding unless the caller opted out.
 * Landing policy is not a screen's business and does not travel with it, so
 * what is left here is the reading half — the organization the page is about,
 * the project and team the reader is standing in, and what they may do — served
 * by the host.
 *
 * `useFeatureFlag` kept its two-field answer rather than collapsing to a
 * boolean, because one call site needs the difference: a `SEND_WEBHOOK` prefill
 * must wait for the flag rather than be dropped while it is still in flight.
 * The platform hook's options object is gone with the query it configured — the
 * host has already resolved every flag for the document.
 */

import { useMemo } from "react";
import {
  useAutomationHost,
  type AutomationOrganization,
  type AutomationProject,
  type AutomationTeam,
} from "../model/automation-host";

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
