#!/usr/bin/env npx tsx
/**
 * Prompt compiler — generates self-contained copy-paste prompts from AgentSkills.
 *
 * Usage:
 *   npx tsx skills/_compiler/compile.ts --skills tracing --mode platform
 *   npx tsx skills/_compiler/compile.ts --skills tracing,evaluations --mode docs
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
  "user-prompt"?: string;
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

function resolveReferences(
  body: string,
  skillDir: string,
  seenShared: Set<string>
): string {
  // Replace `See [text](_shared/file.md).` (or just `[text](_shared/file.md)`)
  // with inlined content the first time it's referenced, and a short "(see X
  // above)" stub on subsequent references within the same compile run.
  return body.replace(
    /(?:See\s+)?\[([^\]]+)\]\((_shared\/[^)]+\.md)\)\.?/g,
    (_match, text: string, refPath: string) => {
      if (seenShared.has(refPath)) {
        return `(see "${text}" above)`;
      }
      seenShared.add(refPath);
      const fullPath = path.join(skillDir, refPath);
      if (fs.existsSync(fullPath)) {
        return fs.readFileSync(fullPath, "utf8").trim();
      }
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

// Deduplication is handled in `resolveReferences` via the `seenShared` set —
// each `_shared/*.md` partial is inlined exactly once per compile run; later
// references collapse to a short "(see X above)" stub.

// ──────────────────────────────────────────────────
// Level-up composition
// ──────────────────────────────────────────────────

const LEVEL_UP_SKILLS = ["tracing", "prompts", "evaluations", "scenarios"];

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

function compileSkill(
  skillName: string,
  seenShared: Set<string>
): { body: string; userPrompt?: string } {
  const skillDir = path.join(skillsRoot, skillName);
  const skillMdPath = path.join(skillDir, "SKILL.md");

  if (!fs.existsSync(skillMdPath)) {
    throw new Error(`Skill not found: ${skillName} (looked at ${skillMdPath})`);
  }

  const parsed = parseSkillMd(skillMdPath);
  const userPrompt = parsed.frontmatter["user-prompt"]?.replace(/^["']|["']$/g, "");
  return { body: resolveReferences(parsed.body, skillDir, seenShared), userPrompt };
}

function compile(options: CompileOptions): string {
  const { skills, mode, apiKey } = options;

  // Expand composed skills
  const expandedSkills = skills.flatMap((s) =>
    isComposedSkill(s) ? getComposedSkillNames(s) : [s]
  );

  // Remove duplicates while preserving order
  const uniqueSkills = [...new Set(expandedSkills)];

  // Track which `_shared/*.md` files we've already inlined for this compile
  // run; second references collapse to "(see X above)" stubs.
  const seenShared = new Set<string>();

  // For composed skills, get the user-prompt from the original (not expanded)
  // skill — but use a throwaway `seenShared` set so we don't pollute the real one.
  const originalUserPrompt = skills.length === 1
    ? compileSkill(skills[0], new Set()).userPrompt
    : undefined;

  // Compile each expanded skill, threading the shared `seen` set so partials
  // are inlined exactly once across the composition.
  const compiledResults = uniqueSkills.map((s) => compileSkill(s, seenShared));
  const compiledSections = compiledResults.map((r) => r.body);

  // Use user-prompt from the original skill, falling back to first expanded
  const userPrompt = originalUserPrompt || compiledResults[0]?.userPrompt;

  // Apply API key handling
  const combined = handleApiKey(
    compiledSections.join("\n\n---\n\n"),
    mode,
    apiKey
  );

  const header = userPrompt
    ? `${userPrompt}\n\nYou are using LangWatch for your AI agent project. Follow these instructions.`
    : `You are using LangWatch for your AI agent project. Follow these instructions.`;

  // Both notes live as `_shared/*.md` partials so non-engineers can edit them
  // without touching this script. They're injected in both docs and platform
  // modes — even when the platform pre-populates a key, an agent that falls
  // back to the CLI still needs to know LANGWATCH_API_KEY conventions.
  const readSharedNote = (filename: string): string =>
    fs.readFileSync(path.join(skillsRoot, "_shared", filename), "utf8").trim();

  const apiKeyNote = `\n\n${readSharedNote("api-key-setup.md")}`;
  const cliNote = `\n${readSharedNote("cli-install.md")}\n`;

  return `${header}${apiKeyNote}${cliNote}\n${combined}`;
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
  --skills    Comma-separated skill names (e.g., tracing,evaluations)
  --mode      Output mode: "platform" (injects API key) or "docs" (asks for API key)
  --api-key   API key to inject (platform mode only; defaults to {{LANGWATCH_API_KEY}})

Available skills:
  tracing, evaluations, scenarios, prompts, analytics, level-up

Examples:
  npx tsx compile.ts --skills tracing --mode platform --api-key sk-lw-xxx
  npx tsx compile.ts --skills level-up --mode docs
  npx tsx compile.ts --skills tracing,scenarios --mode platform`);
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
