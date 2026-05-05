import { resolveControlPlaneUrl } from "@/cli/utils/governance/resolveEndpoint";

/**
 * Build the public-facing LangWatch UI URL for a VK detail page, given the
 * VK's project_id and its id. Honours `LANGWATCH_UI_ENDPOINT` for split
 * UI/API hosts; otherwise delegates to the unified control-plane resolver.
 *
 * Returns an empty string if we can't resolve a sensible base URL so callers
 * can choose to hide the hint entirely rather than print a broken link.
 */
export function virtualKeyDetailUrl(projectId: string, vkId: string): string {
  const uiOverride = process.env.LANGWATCH_UI_ENDPOINT;
  const base = (uiOverride ?? resolveControlPlaneUrl()).replace(/\/+$/, "");
  if (!base) return "";
  return `${base}/${encodeURIComponent(projectId)}/gateway/virtual-keys/${encodeURIComponent(vkId)}`;
}
