import { listPrompts as apiListPrompts } from "../langwatch-api.js";

/**
 * Handles the list_prompts MCP tool invocation.
 *
 * Lists all prompts in the LangWatch project, formatted as an
 * AI-readable markdown table.
 */
export async function handleListPrompts(): Promise<string> {
  const prompts = (await apiListPrompts()) as any[];

  if (!Array.isArray(prompts) || prompts.length === 0) {
    return "No prompts found in this project.";
  }

  const lines: string[] = [];
  lines.push(`# Prompts (${prompts.length} total)\n`);
  lines.push("| Handle | Name | Latest Version | Description |");
  lines.push("|--------|------|----------------|-------------|");

  for (const p of prompts) {
    const handle = p.handle || p.id || "N/A";
    const name = p.name || "Untitled";
    const version = p.latestVersionNumber ?? p.version ?? "N/A";
    const desc = (p.description || "").slice(0, 60);
    lines.push(`| ${handle} | ${name} | v${version} | ${desc} |`);
  }

  lines.push(
    "\n> Use `get_prompt` with the handle or ID to see full prompt details."
  );

  return lines.join("\n");
}
