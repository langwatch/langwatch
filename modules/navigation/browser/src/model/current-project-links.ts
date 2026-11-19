import { scopeFilterAddressWrite } from "@langwatch/design-system/scope-filter";

import { API_KEYS_HREF, PROJECT_SETTINGS_HREF } from "./settings-menu.ts";

/**
 * Where the switcher's current-project header leads, each only when the reader can open it:
 * the project's settings, and its API keys filtered to it. An aggregate project takes no key.
 */
export function currentProjectLinks({
  projectId,
  isAggregate,
  canOpenSettings,
  canOpenApiKeys,
}: {
  projectId: string;
  isAggregate: boolean;
  canOpenSettings: boolean;
  canOpenApiKeys: boolean;
}): { settingsHref: string | null; apiKeysHref: string | null } {
  const settingsHref = canOpenSettings ? PROJECT_SETTINGS_HREF : null;
  if (isAggregate || !canOpenApiKeys) return { settingsHref, apiKeysHref: null };
  const write = scopeFilterAddressWrite({ kind: "project-current" }, { projectId });
  const query = write.kind === "set" ? `?${new URLSearchParams({ scope: write.value })}` : "";
  return { settingsHref, apiKeysHref: `${API_KEYS_HREF}${query}` };
}
