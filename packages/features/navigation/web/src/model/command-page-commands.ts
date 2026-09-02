import type { Command } from "./command-bar-types";

// Registry of page-specific commands. Empty since the legacy Traces page —
// the only page that ever registered any — was removed; the extension point
// stays for the next page that wants one.
export const pageCommandRegistry: Record<string, Command[]> = {};

export function getPageCommands(pathname: string): Command[] {
  // Remove trailing slash before normalizing: /foo/traces/ → /foo/traces
  const trimmed = pathname.replace(/\/$/, "");
  // Match dynamic routes: /foo/traces → /[project]/traces
  const normalized = trimmed.replace(/^\/[^/]+/, "/[project]");
  return pageCommandRegistry[normalized] ?? [];
}
