/**
 * The operator console's menu, resolved against the host this shell is mounted in.
 * Spec: specs/navigation/ops-navigation-v2.feature
 */

import { hostingOf } from "@langwatch/browser-host/deployment";
import { FrontendFlags } from "@langwatch/feature-flag-contract";

import { useNavigationHost } from "../model/navigation-host.ts";
import { adminMenu, type SettingsMenuGroup } from "../model/settings-menu.ts";

export function useAdminMenu(): SettingsMenuGroup[] {
  const host = useNavigationHost();
  const opsAccess = host.opsAccess();

  return adminMenu({
    hasCloudOps: host.deployment().hasCloudOps,
    hosting: hostingOf(host.deployment()),
    hasOpsAccess: opsAccess.hasAccess,
    isPlatformAdmin: opsAccess.isAdmin,
    hasAgentAccess: host.featureFlag(FrontendFlags.ops_agent_access_enabled).enabled,
  });
}
