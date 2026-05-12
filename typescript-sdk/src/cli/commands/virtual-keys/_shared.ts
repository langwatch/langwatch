import { DEFAULT_ENDPOINT } from "@/internal/constants";

/**
 * Build the public-facing LangWatch UI URL for a VK detail page, given the
 * VK's project_id and its id. Falls back to LANGWATCH_ENDPOINT / default.
 *
 * Returns an empty string if we can't resolve a sensible base URL so callers
 * can choose to hide the hint entirely rather than print a broken link.
 */
export function virtualKeyDetailUrl(projectId: string, vkId: string): string {
  const raw =
    process.env.LANGWATCH_UI_ENDPOINT ??
    process.env.LANGWATCH_ENDPOINT ??
    DEFAULT_ENDPOINT;
  if (!raw) return "";
  const base = raw.replace(/\/+$/, "");
  return `${base}/${encodeURIComponent(projectId)}/gateway/virtual-keys/${encodeURIComponent(vkId)}`;
}
