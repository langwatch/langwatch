#!/usr/bin/env npx tsx
/**
 * Prompt compiler — generates self-contained copy-paste prompts from AgentSkills.
 *
 * Usage:
 *   npx tsx skills/_compiler/compile.ts --skills instrument --mode platform
 *   npx tsx skills/_compiler/compile.ts --skills instrument,experiment --mode docs
 *   npx tsx skills/_compiler/compile.ts --skills level-up --mode platform --api-key sk-lw-xxx
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const skillsRoot = path.resolve(__dirname, "..");

// ──────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────

interface SkillFrontmatter {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
}

interface ParsedSkill {
  frontmatter: SkillFrontmatter;
  body: string;
  path: string;
}

type CompileMode = "platform" | "docs";

interface CompileOptions {
  skills: string[];
  mode: CompileMode;
  apiKey?: string;
}

// ──────────────────────────────────────────────────
// Parsing
// ──────────────────────────────────────────────────

function parseSkillMd(skillPath: string): ParsedSkill {
  const content = fs.readFileSync(skillPath, "utf8");
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!frontmatterMatch) {
    throw new Error(`Invalid SKILL.md format: ${skillPath}`);
  }

  const frontmatterRaw = frontmatterMatch[1];
  const body = frontmatterMatch[2].trim();

  // Simple YAML parser for the frontmatter fields we care about
  const frontmatter: Record<string, string> = {};
  for (const line of frontmatterRaw.split("\n")) {
    const match = line.match(/^(\w[\w-]*?):\s*(.+)$/);
    if (match) {
      frontmatter[match[1]] = match[2].trim();
    }
  }

  return {
    frontmatter: frontmatter as unknown as SkillFrontmatter,
    body,
    path: skillPath,
  };
}

// ──────────────────────────────────────────────────
// Reference resolution
// ──────────────────────────────────────────────────

function resolveReferences(body: string, skillDir: string): string {
  // Replace [text](_shared/file.md) with inlined content
  return body.replace(
    /(?:See\s+)?\[([^\]]+)\]\((_shared\/[^)]+\.md)\)(?:\s*for[^.]*\.)?/g,
    (_match, _text: string, refPath: string) => {
      const fullPath = path.join(skillDir, refPath);
      if (fs.existsSync(fullPath)) {
        return fs.readFileSync(fullPath, "utf8").trim();
      }
      // Also check in the skills root _shared
      const rootPath = path.join(skillsRoot, refPath);
      if (fs.existsSync(rootPath)) {
        return fs.readFileSync(rootPath, "utf8").trim();
      }
      return `[Reference: ${refPath}]`;
    }
  );
}

// ──────────────────────────────────────────────────
// API key handling
// ──────────────────────────────────────────────────

function handleApiKey(content: string, mode: CompileMode, apiKey?: string): string {
  if (mode === "platform") {
    const key = apiKey || "{{LANGWATCH_API_KEY}}";
    // Replace all API key placeholders with the actual key or template variable
    return content
      .replace(/YOUR_API_KEY/g, key)
      .replace(/your-api-key-here/g, key)
      .replace(/your-key-here/g, key);
  }

  // Docs mode: add instruction to ask user
  const askForKeyBlock = `
**API Key**: Ask the user for their LangWatch API key. They can get one at https://app.langwatch.ai/authorize
Once they provide it, use it wherever you see a placeholder below.`;

  return content
    .replace(
      /# LangWatch API Key Setup[\s\S]*?(?=\n#|$)/,
      askForKeyBlock
    )
    .replace(
      /YOUR_API_KEY/g,
      "ASK_USER_FOR_LANGWATCH_API_KEY"
    )
    .replace(
      /your-api-key-here/g,
      "ASK_USER_FOR_LANGWATCH_API_KEY"
    )
    .replace(
      /your-key-here/g,
      "ASK_USER_FOR_LANGWATCH_API_KEY"
    );
}

// ──────────────────────────────────────────────────
// Deduplication
// ──────────────────────────────────────────────────

function deduplicateSharedContent(sections: string[]): string {
  if (sections.length <= 1) return sections.join("\n\n---\n\n");

  // Track which shared blocks we've already included
  const seen = new Set<string>();
  const deduplicated: string[] = [];

  for (const section of sections) {
    const lines = section.split("\n");
    const filtered: string[] = [];
    let skipUntilNextHeader = false;
    let currentSharedBlock = "";

    for (const line of lines) {
      // Detect shared content blocks (MCP setup, API key setup, etc.)
      if (line.startsWith("# Installing the LangWatch MCP") ||
          line.startsWith("# LangWatch API Key Setup") ||
          line.startsWith("# Fetching LangWatch Docs Without MCP")) {
        if (seen.has(line)) {
          skipUntilNextHeader = true;
          currentSharedBlock = line;
          continue;
        }
        seen.add(line);
      }

      if (skipUntilNextHeader) {
        // Skip until we hit the next major section header
        if (line.startsWith("## Step") || line.startsWith("## Common") || line.startsWith("# ")) {
          if (line !== currentSharedBlock) {
            skipUntilNextHeader = false;
            filtered.push(`(See MCP/API key setup above)`);
            filtered.push("");
            filtered.push(line);
          }
        }
        continue;
      }

      filtered.push(line);
    }

    deduplicated.push(filtered.join("\n"));
  }

  return deduplicated.join("\n\n---\n\n");
}

// ──────────────────────────────────────────────────
// Level-up composition
// ──────────────────────────────────────────────────

const LEVEL_UP_SKILLS = ["instrument", "prompt-versioning", "experiment", "scenario-test"];

function isComposedSkill(skillName: string): boolean {
  return skillName === "level-up";
}

function getComposedSkillNames(skillName: string): string[] {
  if (skillName === "level-up") return LEVEL_UP_SKILLS;
  return [skillName];
}

// ──────────────────────────────────────────────────
// Compilation
// ──────────────────────────────────────────────────

function compileSkill(skillName: string): string {
  const skillDir = path.join(skillsRoot, skillName);
  const skillMdPath = path.join(skillDir, "SKILL.md");

  if (!fs.existsSync(skillMdPath)) {
    throw new Error(`Skill not found: ${skillName} (looked at ${skillMdPath})`);
  }

  const parsed = parseSkillMd(skillMdPath);
  return resolveReferences(parsed.body, skillDir);
}

function compile(options: CompileOptions): string {
  const { skills, mode, apiKey } = options;

  // Expand composed skills
  const expandedSkills = skills.flatMap((s) =>
    isComposedSkill(s) ? getComposedSkillNames(s) : [s]
  );

  // Remove duplicates while preserving order
  const uniqueSkills = [...new Set(expandedSkills)];

  // Compile each skill
  const compiledSections = uniqueSkills.map(compileSkill);

  // Deduplicate shared content
  let combined: string;
  if (uniqueSkills.length === 1) {
    combined = compiledSections[0];
  } else {
    combined = deduplicateSharedContent(compiledSections);
  }

  // Apply API key handling
  combined = handleApiKey(combined, mode, apiKey);

  // Wrap in a prompt envelope
  const header = mode === "platform"
    ? `You are helping the user set up LangWatch for their AI agent project. Follow these instructions carefully.`
    : `You are helping the user set up LangWatch for their AI agent project. Follow these instructions carefully.\n\nIMPORTANT: You will need the user's LangWatch API key. Ask them for it and direct them to https://app.langwatch.ai/authorize if they don't have one.`;

  const mcpNote = `\nFirst, try to install the LangWatch MCP server for access to documentation and platform tools. If installation fails, you can fetch docs directly via the URLs provided below.\n`;

  return `${header}\n${mcpNote}\n${combined}`;
}

// ──────────────────────────────────────────────────
// CLI
// ──────────────────────────────────────────────────

function parseArgs(): CompileOptions {
  const args = process.argv.slice(2);
  let skills: string[] = [];
  let mode: CompileMode = "docs";
  let apiKey: string | undefined;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--skills":
        skills = args[++i].split(",");
        break;
      case "--mode":
        mode = args[++i] as CompileMode;
        break;
      case "--api-key":
        apiKey = args[++i];
        break;
      case "--help":
        console.log(`Usage: compile.ts --skills <skill1,skill2> --mode <platform|docs> [--api-key <key>]

Options:
  --skills    Comma-separated skill names (e.g., instrument,experiment)
  --mode      Output mode: "platform" (injects API key) or "docs" (asks for API key)
  --api-key   API key to inject (platform mode only; defaults to {{LANGWATCH_API_KEY}})

Available skills:
  instrument, experiment, scenario-test, prompt-versioning, red-team, level-up,
  platform-experiment, platform-scenario, analytics

Examples:
  npx tsx compile.ts --skills instrument --mode platform --api-key sk-lw-xxx
  npx tsx compile.ts --skills level-up --mode docs
  npx tsx compile.ts --skills instrument,scenario-test --mode platform`);
        process.exit(0);
    }
  }

  if (skills.length === 0) {
    console.error("Error: --skills is required. Use --help for usage.");
    process.exit(1);
  }

  return { skills, mode, apiKey };
}

// ──────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────

const options = parseArgs();
const result = compile(options);
console.log(result);
