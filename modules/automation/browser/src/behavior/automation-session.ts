/** Scope/permission reads from platform hooks (without landing policy). */

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

/** Closes the drawer the address names by clearing its `drawer.*` keys. */
export function useCloseAddressedDrawer(): () => void {
  const host = useAutomationHost();
  return () =>
    host.setQuery(
      Object.fromEntries(
        Object.entries(host.route().query).filter(([key]) => !key.startsWith("drawer.")),
      ),
    );
}

/** This application's own address, for the links a rendered preview prints. */
export function useAppBaseUrl(): string {
  return useAutomationHost().appBaseUrl();
}
