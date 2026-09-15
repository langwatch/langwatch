/**
 * The LangWatch guidance block in codex's global `AGENTS.md`.
 *
 * Codex has no channel that injects always-loaded context into a session:
 * its notify program and hooks are fire-and-forget notifications whose
 * output never reaches the model, and the Agent Plugins 1.0 portable core
 * carries only skills (progressive disclosure, matched against the user's
 * request) and MCP servers. A standing "whenever YOU switch repository or
 * branch, declare it" rule needs to sit in front of the model in every
 * session, and the AGENTS.md hierarchy is the one channel codex loads that
 * way, with `$CODEX_HOME/AGENTS.md` as its global layer.
 *
 * RETIREMENT NOTE: the moment codex (or the Agent Plugins standard) ships an
 * always-loaded context channel a plugin can carry, this block should move
 * there and this writer should be retired. The guidance text itself already
 * lives in `session-guidance.ts`, shared with the claude plugin's
 * additionalContext hook, so only the delivery would change.
 *
 * The block is bracketed in HTML comment markers so nothing of ours renders
 * as markdown structure, and everything of the user's is byte-preserved:
 * install replaces exactly our region or appends after their content, and
 * removal deletes exactly our region. Same ownership doctrine as the shell
 * rc and codex config.toml marker blocks.
 *
 * Spec: specs/ai-governance/cli-wrappers/session-context-declare.feature
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { SESSION_CONTEXT_GUIDANCE } from "./session-guidance";

const GUIDANCE_BEGIN = "<!-- >>> langwatch agent guidance begin >>> -->";
const GUIDANCE_END = "<!-- <<< langwatch agent guidance end <<< -->";

/** `$CODEX_HOME/AGENTS.md`, the global layer of codex's AGENTS.md hierarchy. */
export function defaultCodexAgentsMdPath(): string {
  const codexHome = process.env.CODEX_HOME;
  return codexHome
    ? path.join(codexHome, "AGENTS.md")
    : path.join(os.homedir(), ".codex", "AGENTS.md");
}

/** The whole managed block, markers included, with a trailing newline. */
export function buildCodexAgentGuidanceBlock(): string {
  return [
    GUIDANCE_BEGIN,
    "<!-- Managed by 'langwatch'. Remove the marker pair to opt out. -->",
    "",
    SESSION_CONTEXT_GUIDANCE,
    "",
    GUIDANCE_END,
    "",
  ].join("\n");
}

function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Our region: the markers and everything between them, plus one trailing newline. */
function guidanceRegionRe(): RegExp {
  return new RegExp(`${escapeRe(GUIDANCE_BEGIN)}[\\s\\S]*?${escapeRe(GUIDANCE_END)}\\n?`, "m");
}

/**
 * The region plus the one newline install put in front of it to separate it
 * from the user's content. Removing this and nothing else restores a
 * non-empty file byte for byte.
 */
function guidanceRemovalRe(): RegExp {
  return new RegExp(`\\n?${escapeRe(GUIDANCE_BEGIN)}[\\s\\S]*?${escapeRe(GUIDANCE_END)}\\n?`, "m");
}

/**
 * Whether the file carries a complete LangWatch guidance block. A lone begin
 * marker is not one: removal accepts only a complete region, so anything
 * looser would report a target that cannot be removed.
 */
export function hasCodexAgentGuidance(filePath = defaultCodexAgentsMdPath()): boolean {
  try {
    return guidanceRegionRe().test(fs.readFileSync(filePath, "utf8"));
  } catch {
    return false;
  }
}

/**
 * Install or refresh the guidance block. The user's own content is never
 * touched: a present block is replaced in place, an absent one is appended
 * after whatever the file holds. Reports whether anything changed.
 */
export function installCodexAgentGuidance(filePath = defaultCodexAgentsMdPath()): {
  changed: boolean;
} {
  const block = buildCodexAgentGuidanceBlock();
  let content = "";
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    // Only an absent file means "the block becomes the file". Any other read
    // failure, a permission error above all, must not fall through to a write
    // that would replace the user's content with our block alone.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  let next: string;
  const region = guidanceRegionRe().exec(content);
  if (region) {
    next = content.slice(0, region.index) + block + content.slice(region.index + region[0].length);
  } else if (content === "") {
    next = block;
  } else {
    // Exactly one newline separates the user's content from our region, and
    // removal takes that newline back with the region. The user's own bytes,
    // trailing newlines included, are left as they are.
    next = `${content}\n${block}`;
  }

  if (next === content) return { changed: false };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, next);
  return { changed: true };
}

/**
 * Remove exactly the guidance block. A file that then holds nothing but
 * whitespace is deleted outright, so a file that existed only to carry our
 * block does not linger empty; a file with the user's own content keeps it
 * byte for byte. Reports whether anything was removed.
 */
export function removeCodexAgentGuidance(filePath = defaultCodexAgentsMdPath()): boolean {
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch {
    return false;
  }
  const region = guidanceRemovalRe().exec(content);
  if (!region) return false;

  const remainder = content.slice(0, region.index) + content.slice(region.index + region[0].length);
  if (remainder.trim() === "") {
    fs.unlinkSync(filePath);
    return true;
  }
  fs.writeFileSync(filePath, remainder);
  return true;
}

/**
 * Assert the guidance beside the other codex wiring, quietly. A write that
 * fails is not worth failing the persist over: the exporters and the harvest
 * it rides beside are already installed, and the next persist retries.
 */
export function assertCodexAgentGuidance(): void {
  try {
    installCodexAgentGuidance();
  } catch {
    /* the next instrument or refresh retries */
  }
}
