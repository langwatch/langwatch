import { listPrompts as apiListPrompts } from "../langwatch-api.js";

/**
 * Handles the platform_list_prompts MCP tool invocation.
 *
 * Lists all prompts in the LangWatch project, formatted as an
 * AI-readable markdown table.
 */
export async function handleListPrompts(): Promise<string> {
  const prompts = await apiListPrompts();

  if (!Array.isArray(prompts) || prompts.length === 0) {
    return "No prompts found in this project.";
  }

  const lines: string[] = [];
  lines.push(`# Prompts (${prompts.length} total)\n`);
  lines.push("| Handle | Name | Latest Version | Tags |");
  lines.push("|--------|------|----------------|------|");

  for (const p of prompts) {
    const handle = p.handle || p.id || "N/A";
    const name = p.name || "Untitled";
    const versionNum = p.latestVersionNumber ?? p.version;
    const version = versionNum != null ? `v${versionNum}` : "N/A";
    const tags =
      p.tags && p.tags.length > 0 ? p.tags.map((t) => t.name).join(", ") : "—";
    lines.push(`| ${handle} | ${name} | ${version} | ${tags} |`);
  }

  lines.push(
    "\n> Use `platform_get_prompt` with the handle or ID to see full prompt details."
  );

  return lines.join("\n");
}
