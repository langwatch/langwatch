/**
 * The one warning a process gives when `/api/v1/dashboards` answers with a `Deprecation` header:
 * once to stderr when first seen, and once appended to a dashboards tool's result. The route
 * keeps working. Spec: modules/dashboard/specs/dashboards-v2.feature AC199s.
 */

export const DASHBOARDS_DEPRECATION_NOTE =
  "Note: /api/v1/dashboards is deprecated for this project; use list_dashboard_boards and the other board tools (/api/v1/boards).";

import { createHash } from "node:crypto";

import { tryGetConfig } from "./config.ts";

// The HTTP server serves many API keys in one process, so the flag state is kept per key.
// Keys are hashed so raw secrets do not sit in long-lived memory.
const seen = new Set<string>();
const surfaced = new Set<string>();

const currentKey = (): string =>
  createHash("sha256")
    .update(tryGetConfig()?.apiKey ?? "")
    .digest("hex")
    .slice(0, 16);

/** Records a response's deprecation; only `/api/v1/dashboards` answers count. */
export function noteDashboardsDeprecation({
  path,
  headers,
}: {
  path: string;
  headers: Headers | undefined;
}): void {
  const key = currentKey();
  if (seen.has(key) || !path.startsWith("/api/v1/dashboards")) return;
  if (!headers?.get("Deprecation")) return;
  seen.add(key);
  process.stderr.write(`${DASHBOARDS_DEPRECATION_NOTE}\n`);
}

/** The tool's text, with the note appended the first time one was seen and not yet shown. */
export function withDashboardsDeprecationNote(text: string): string {
  const key = currentKey();
  if (!seen.has(key) || surfaced.has(key)) return text;
  surfaced.add(key);
  return `${text}\n\n${DASHBOARDS_DEPRECATION_NOTE}`;
}

/** Test seam: forget what this process has seen and shown. */
export function resetDashboardsDeprecation(): void {
  seen.clear();
  surfaced.clear();
}
