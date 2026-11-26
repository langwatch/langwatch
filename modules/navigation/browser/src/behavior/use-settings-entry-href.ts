import { useNavigationHost } from "../model/navigation-host.ts";
import { settingsEntryHref } from "../model/settings-entry.ts";

/** Where every Settings entry opens, read off the address on screen (settings-shell-v2). */
export function useSettingsEntryHref(): string {
  const host = useNavigationHost();
  return settingsEntryHref({
    projectSlugFromAddress: host.projectSlugFromAddress(),
    project: host.project(),
    isPersonalTeam: host.team()?.isPersonal === true,
    canUpdateProject: host.hasPermission("project:update"),
  });
}
