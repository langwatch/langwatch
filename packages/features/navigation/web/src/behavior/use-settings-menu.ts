/**
 * The settings menu, resolved against the host this shell is mounted in.
 *
 * The gates the menu turns on — the plan tier, the lite membership role, the
 * grants, whether this is the hosted product, and how far the reader reaches
 * into the operations pages — are all answers the host already holds, so this
 * asks once and hands them to the pure builder.
 *
 * Spec: specs/navigation/settings-shell-v2.feature
 */

import { useNavigationHost } from "../model/navigation-host";
import { settingsMenu, type SettingsMenuGroup } from "../model/settings-menu";

export function useSettingsMenu(): SettingsMenuGroup[] {
  const host = useNavigationHost();
  const plan = host.plan();
  const opsAccess = host.opsAccess();

  return settingsMenu({
    hasPermission: (permission) => host.hasPermission(permission),
    isSaaS: host.deployment().isSaaS,
    // Deliberately not `isEnterprise`: the enterprise entries are shown WHILE
    // the plan is still arriving, so a reader on that plan never watches four
    // links appear a beat after the page.
    showEnterpriseNav: plan.isLoading || plan.isEnterprise,
    isLiteMember: plan.isLiteMember,
    hasOpsAccess: opsAccess.hasAccess,
    isPlatformAdmin: opsAccess.isAdmin,
  });
}
