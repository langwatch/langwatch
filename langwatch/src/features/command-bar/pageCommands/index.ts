import type { Command } from "../types";
import { tracesPageCommands } from "./tracesPageCommands";

// Registry of page-specific commands
export const pageCommandRegistry: Record<string, Command[]> = {
  "/[project]/messages": tracesPageCommands,
  // Add more pages as needed
};

export function getPageCommands(pathname: string): Command[] {
  // Match dynamic routes: /foo/messages → /[project]/messages
  const normalized = pathname.replace(/^\/[^/]+/, "/[project]");
  return pageCommandRegistry[normalized] ?? [];
}
