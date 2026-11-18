import { scopeFilterAddressWrite } from "@langwatch/design-system/scope-filter";

const PROJECT_SETTINGS_HREF = "/settings/project";
const API_KEYS_HREF = "/settings/api-keys";

/**
 * Where the switcher's current-project header leads: the project's settings, and its
 * API keys filtered to it. An aggregate project takes no key, so it has no keys link.
 */
export function currentProjectLinks({
  projectId,
  isAggregate,
}: {
  projectId: string;
  isAggregate: boolean;
}): { settingsHref: string; apiKeysHref: string | null } {
  if (isAggregate) return { settingsHref: PROJECT_SETTINGS_HREF, apiKeysHref: null };
  const write = scopeFilterAddressWrite({ kind: "project-current" }, { projectId });
  const query = write.kind === "set" ? `?${new URLSearchParams({ scope: write.value })}` : "";
  return { settingsHref: PROJECT_SETTINGS_HREF, apiKeysHref: `${API_KEYS_HREF}${query}` };
}
