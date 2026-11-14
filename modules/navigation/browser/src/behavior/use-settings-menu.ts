/**
 * The settings menu, resolved against the host this shell is mounted in.
 * Spec: specs/navigation/settings-shell-v2.feature
 */

import { hostingOf } from "@langwatch/browser-host/deployment";
import { FrontendFlags } from "@langwatch/feature-flag-contract";

import { useNavigationHost } from "../model/navigation-host.ts";
import {
  enterprisePlanGate,
  settingsMenu,
  type SettingsMenuGroup,
} from "../model/settings-menu.ts";

export function useSettingsMenu(): SettingsMenuGroup[] {
  const host = useNavigationHost();
  const plan = host.plan();
  const opsAccess = host.opsAccess();
  const braids = host.featureFlag(FrontendFlags.release_braids);

  return settingsMenu({
    hasPermission: (permission) => host.hasPermission(permission),
    hasOrganizationPermission: (permission) => host.hasOrganizationPermission(permission),
    isSaaS: host.deployment().isSaaS,
    hasCloudOps: host.deployment().hasCloudOps,
    hosting: hostingOf(host.deployment()),
    enterprisePlan: enterprisePlanGate(plan),
    isLiteMember: plan.isLiteMember,
    hasOpsAccess: opsAccess.hasAccess,
    isPlatformAdmin: opsAccess.isAdmin,
    // Hidden while the flag is still loading: an entry must not appear and then vanish.
    braidsEnabled: braids.enabled && !braids.isLoading,
  });
}
