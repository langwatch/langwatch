#!/usr/bin/env npx tsx
/**
 * Prompt compiler -- generates self-contained copy-paste prompts from SKILL.md files.
 *
 * Parses SKILL.md frontmatter, resolves all file references (shared and local),
 * applies API key mode (platform or docs), and wraps in a prompt envelope.
 *
 * Usage:
 *   npx tsx skills/_compiler/compile.ts --skills create-agent --mode platform
 *   npx tsx skills/_compiler/compile.ts --skills create-agent --mode docs
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// ──────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────

export interface SkillFrontmatter {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
}

export interface ParsedSkill {
  frontmatter: SkillFrontmatter;
  body: string;
}

export type CompileMode = "platform" | "docs";

// ──────────────────────────────────────────────────
// Parsing
// ──────────────────────────────────────────────────

/**
 * Parses YAML frontmatter and body from SKILL.md content.
 * Expects content delimited by `---` markers at the top.
 */
export function parseFrontmatter(content: string): ParsedSkill {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    throw new Error("Invalid SKILL.md format: missing frontmatter delimiters");
  }

  const frontmatterRaw = match[1]!;
  const body = match[2]!.trim();

  const frontmatter: Record<string, string> = {};
  for (const line of frontmatterRaw.split("\n")) {
    const kvMatch = line.match(/^(\w[\w-]*?):\s*(.+)$/);
    if (kvMatch) {
      frontmatter[kvMatch[1]!] = kvMatch[2]!.trim();
    }
  }

  return {
    frontmatter: frontmatter as unknown as SkillFrontmatter,
    body,
  };
}

// ──────────────────────────────────────────────────
// Reference resolution
// ──────────────────────────────────────────────────

/**
 * Resolves markdown file references by inlining their content.
 *
 * Handles three patterns:
 * - `[text](_shared/file.md)` -- shared references, resolved from sharedDir
 * - `[text](references/file.md)` -- local references, resolved from skillDir
 * - `[text](file.md)` -- relative cross-references within inlined shared content
 *
 * References with surrounding prose (e.g., "See [text](file) for details.")
 * are replaced with just the inlined content.
 */
export function resolveReferences({
  body,
  skillDir,
  sharedDir,
}: {
  body: string;
  skillDir: string;
  sharedDir: string;
}): string {
  // First pass: resolve _shared/ and references/ links
  const referencePattern =
    /(?:See\s+)?\[([^\]]+)\]\(((?:_shared|references)\/[^)]+\.md)\)(?:\s+for[^.\n]*\.)?/g;

  let result = body.replace(referencePattern, (_match, _linkText: string, refPath: string) => {
    // Try resolving from the skill directory first (for references/ paths)
    const fromSkillDir = path.join(skillDir, refPath);
    if (fs.existsSync(fromSkillDir)) {
      return fs.readFileSync(fromSkillDir, "utf8").trim();
    }

    // Try resolving from the shared directory (for _shared/ paths)
    const fromSharedDir = path.join(sharedDir, path.basename(refPath));
    if (fs.existsSync(fromSharedDir)) {
      return fs.readFileSync(fromSharedDir, "utf8").trim();
    }

    return `[Unresolved reference: ${refPath}]`;
  });

  // Second pass: resolve relative .md links from inlined shared files
  // These are cross-references like [MCP Setup](mcp-setup.md) within shared content.
  // Since the referenced content is typically already inlined elsewhere in the doc,
  // we replace the link with "(see above)" to avoid duplication.
  const relativeRefPattern =
    /(?:See\s+)?\[([^\]]+)\]\(([^/)][^)]*\.md)\)(?:\s+for[^.\n]*\.)?/g;

  result = result.replace(relativeRefPattern, (_match, linkText: string, refPath: string) => {
    // Skip URLs (http/https links)
    if (refPath.startsWith("http")) {
      return _match;
    }
    // Check if the file exists in shared dir -- if so, it was inlined above
    const fromSharedDir = path.join(sharedDir, refPath);
    if (fs.existsSync(fromSharedDir)) {
      return `${linkText} (see above)`;
    }
    // Check in skill dir
    const fromSkillDir = path.join(skillDir, refPath);
    if (fs.existsSync(fromSkillDir)) {
      return `${linkText} (see above)`;
    }
    // Leave as-is if not a resolvable local file
    return _match;
  });

  return result;
}

// ──────────────────────────────────────────────────
// API key mode handling
// ──────────────────────────────────────────────────

/** Placeholder strings that represent API keys in SKILL.md and shared files. */
const API_KEY_PLACEHOLDERS = [
  "YOUR_API_KEY",
  "your-langwatch-api-key",
  "your-api-key-here",
];

/**
 * Applies API key handling based on compile mode.
 *
 * - **platform**: Replaces all API key placeholders with `{{LANGWATCH_API_KEY}}`
 * - **docs**: Replaces placeholders with `ASK_USER_FOR_API_KEY` and prepends
 *   an instruction block telling the agent to ask the user for their key.
 */
export function applyApiKeyMode({
  content,
  mode,
}: {
  content: string;
  mode: CompileMode;
}): string {
  if (mode === "platform") {
    let result = content;
    for (const placeholder of API_KEY_PLACEHOLDERS) {
      result = result.replaceAll(placeholder, "{{LANGWATCH_API_KEY}}");
    }
    return result;
  }

  // Docs mode: replace placeholders and add instruction
  let result = content;
  for (const placeholder of API_KEY_PLACEHOLDERS) {
    result = result.replaceAll(placeholder, "ASK_USER_FOR_API_KEY");
  }

  const askBlock = [
    "",
    "**API Key**: Before proceeding, ask the user for their LangWatch API key.",
    "They can get one at: https://app.langwatch.ai/authorize",
    "Use the provided key wherever you see `ASK_USER_FOR_API_KEY` below.",
    "",
  ].join("\n");

  // Insert the ask block after the first heading
  const firstHeadingEnd = result.indexOf("\n", result.indexOf("# "));
  if (firstHeadingEnd !== -1) {
    result = result.slice(0, firstHeadingEnd) + "\n" + askBlock + result.slice(firstHeadingEnd);
  } else {
    result = askBlock + "\n" + result;
  }

  return result;
}

// ──────────────────────────────────────────────────
// Prompt envelope
// ──────────────────────────────────────────────────

/**
 * Wraps compiled content in a system instruction envelope.
 */
export function wrapInEnvelope({
  content,
  mode,
  skillName,
}: {
  content: string;
  mode: CompileMode;
  skillName: string;
}): string {
  const header =
    mode === "platform"
      ? "You are helping the user set up a new AI agent project with LangWatch instrumentation. Follow these instructions carefully."
      : [
          "You are helping the user set up a new AI agent project with LangWatch instrumentation. Follow these instructions carefully.",
          "",
          "IMPORTANT: You will need the user's LangWatch API key. Ask them for it before starting, and direct them to https://app.langwatch.ai/authorize if they don't have one.",
        ].join("\n");

  return `${header}\n\n${content}`;
}

// ──────────────────────────────────────────────────
// High-level compilation
// ──────────────────────────────────────────────────

/**
 * Compiles a single skill into a self-contained prompt string.
 *
 * @param skillName - Directory name under skills/ (e.g., "create-agent")
 * @param mode - "platform" or "docs"
 * @returns The fully compiled, self-contained prompt text
 */
export function compileSkill({
  skillName,
  mode,
}: {
  skillName: string;
  mode: CompileMode;
}): string {
  const skillsRoot = findSkillsRoot();
  const skillDir = path.join(skillsRoot, skillName);
  const skillMdPath = path.join(skillDir, "SKILL.md");
  const sharedDir = path.join(skillsRoot, "_shared");

  if (!fs.existsSync(skillMdPath)) {
    throw new Error(`Skill not found: ${skillName} (expected ${skillMdPath})`);
  }

  const content = fs.readFileSync(skillMdPath, "utf8");
  const parsed = parseFrontmatter(content);

  // Resolve all file references
  let body = resolveReferences({ body: parsed.body, skillDir, sharedDir });

  // Apply API key mode
  body = applyApiKeyMode({ content: body, mode });

  // Wrap in envelope
  return wrapInEnvelope({ content: body, mode, skillName });
}

// ──────────────────────────────────────────────────
// Path resolution
// ──────────────────────────────────────────────────

function findSkillsRoot(): string {
  // When running as a module (tests), use __dirname relative path
  // When running as CLI, use the script location
  try {
    const thisFile = fileURLToPath(import.meta.url);
    return path.resolve(path.dirname(thisFile), "..");
  } catch {
    // Fallback: look relative to cwd
    return path.resolve(process.cwd(), "skills");
  }
}

// ──────────────────────────────────────────────────
// CLI
// ──────────────────────────────────────────────────

interface CliOptions {
  skills: string[];
  mode: CompileMode;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  let skills: string[] = [];
  let mode: CompileMode = "docs";

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--skills":
        skills = args[++i]!.split(",");
        break;
      case "--mode":
        mode = args[++i] as CompileMode;
        break;
      case "--help":
        console.log(
          `Usage: compile.ts --skills <skill1,skill2> --mode <platform|docs>

Options:
  --skills    Comma-separated skill names (e.g., create-agent)
  --mode      Output mode: "platform" (API key placeholder) or "docs" (asks user for key)

Examples:
  npx tsx compile.ts --skills create-agent --mode platform
  npx tsx compile.ts --skills create-agent --mode docs`
        );
        process.exit(0);
    }
  }

  if (skills.length === 0) {
    console.error("Error: --skills is required. Use --help for usage.");
    process.exit(1);
  }

  return { skills, mode };
}

/** Entry point -- only runs when invoked as a CLI script, not when imported. */
function main(): void {
  const options = parseArgs();

  for (const skillName of options.skills) {
    const result = compileSkill({ skillName, mode: options.mode });
    console.log(result);
  }
}

// Run CLI when executed directly
const isDirectExecution =
  typeof process !== "undefined" &&
  process.argv[1] &&
  (process.argv[1].endsWith("compile.ts") || process.argv[1].endsWith("compile.js"));

if (isDirectExecution) {
  main();
}
