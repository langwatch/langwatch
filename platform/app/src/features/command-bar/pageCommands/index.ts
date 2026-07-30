import type { Command } from "../types";
import { tracesPageCommands } from "./tracesPageCommands";

// Registry of page-specific commands
export const pageCommandRegistry: Record<string, Command[]> = {
  "/[project]/messages": tracesPageCommands,
  // Add more pages as needed
};

export function getPageCommands(pathname: string): Command[] {
  // Remove trailing slash before normalizing: /foo/messages/ → /foo/messages
  const trimmed = pathname.replace(/\/$/, "");
  // Match dynamic routes: /foo/messages → /[project]/messages
  const normalized = trimmed.replace(/^\/[^/]+/, "/[project]");
  return pageCommandRegistry[normalized] ?? [];
}
