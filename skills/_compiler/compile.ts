#!/usr/bin/env npx tsx
/**
 * Prompt compiler — generates self-contained copy-paste prompts from AgentSkills.
 *
 * Usage:
 *   tsx skills/_compiler/compile.ts --skills tracing --mode platform
 *   tsx skills/_compiler/compile.ts --skills tracing,evaluations --mode docs
 *   tsx skills/_compiler/compile.ts --skills level-up --mode platform --api-key sk-lw-xxx
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { inlineMdx } from "../_lib/mdx-inline.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const skillsRoot = path.resolve(__dirname, "..");

type CompileMode = "platform" | "docs";

interface CompileOptions {
  skills: string[];
  mode: CompileMode;
  apiKey?: string;
}

function splitFrontmatter(raw: string): { frontmatter: Record<string, string>; body: string } {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return { frontmatter: {}, body: raw };
  const fm: Record<string, string> = {};
  for (const line of m[1]!.split("\n")) {
    const kv = line.match(/^(\w[\w-]*?):\s*(.+)$/);
    if (kv) fm[kv[1]!] = kv[2]!.trim();
  }
  return { frontmatter: fm, body: m[2]!.trim() };
}

function handleApiKey(content: string, mode: CompileMode, apiKey?: string): string {
  if (mode === "platform") {
    const key = apiKey || "{{LANGWATCH_API_KEY}}";
    return content
      .replace(/YOUR_API_KEY/g, key)
      .replace(/your-api-key-here/g, key)
      .replace(/your-key-here/g, key);
  }

  const askForKeyBlock = `
**API Key**: Ask the user for their LangWatch API key. They can get one at https://app.langwatch.ai/authorize
Once they provide it, use it wherever you see a placeholder below.`;

  return content
    .replace(/# LangWatch API Key Setup[\s\S]*?(?=\n#|$)/, askForKeyBlock)
    .replace(/YOUR_API_KEY/g, "ASK_USER_FOR_LANGWATCH_API_KEY")
    .replace(/your-api-key-here/g, "ASK_USER_FOR_LANGWATCH_API_KEY")
    .replace(/your-key-here/g, "ASK_USER_FOR_LANGWATCH_API_KEY");
}

const LEVEL_UP_SKILLS = ["tracing", "prompts", "evaluations", "scenarios"];

function expandSkill(name: string): string[] {
  return name === "level-up" ? LEVEL_UP_SKILLS : [name];
}

function compileSkill(
  skillName: string,
  seenShared: Set<string>
): { body: string; userPrompt?: string } {
  const skillMdxPath = path.join(skillsRoot, skillName, "SKILL.mdx");
  if (!fs.existsSync(skillMdxPath)) {
    throw new Error(`Skill not found: ${skillName} (looked at ${skillMdxPath})`);
  }
  const inlined = inlineMdx(skillMdxPath, { seenShared, stripFrontmatter: true });
  const { frontmatter } = splitFrontmatter(fs.readFileSync(skillMdxPath, "utf8"));
  const userPrompt = frontmatter["user-prompt"]?.replace(/^["']|["']$/g, "");
  return { body: inlined.trim(), userPrompt };
}

function compile(options: CompileOptions): string {
  const { skills, mode, apiKey } = options;

  const expanded = skills.flatMap(expandSkill);
  const unique = [...new Set(expanded)];

  // Track partials inlined across the multi-skill composition so that the
  // second appearance of, e.g., CliSetup collapses to a "(see X above)" stub.
  const seenShared = new Set<string>();

  // Single-skill calls take their user-prompt from the original skill (not the
  // expansion). Use a throwaway seen-set so it doesn't affect the real run.
  const originalUserPrompt =
    skills.length === 1 ? compileSkill(skills[0]!, new Set()).userPrompt : undefined;

  const compiledResults = unique.map((s) => compileSkill(s, seenShared));
  const compiledSections = compiledResults.map((r) => r.body);
  const userPrompt = originalUserPrompt || compiledResults[0]?.userPrompt;

  const combined = handleApiKey(
    compiledSections.join("\n\n---\n\n"),
    mode,
    apiKey
  );

  const header = userPrompt
    ? `${userPrompt}\n\nYou are using LangWatch for your AI agent project. Follow these instructions.`
    : `You are using LangWatch for your AI agent project. Follow these instructions.`;

  // The api-key + cli-install partials live in `_shared/` so non-engineers can
  // edit them without touching this script. Always injected — even when the
  // platform pre-populates a key, an agent that falls back to the CLI still
  // needs to know LANGWATCH_API_KEY conventions.
  const readSharedNote = (filename: string): string =>
    inlineMdx(path.join(skillsRoot, "_shared", filename), { stripFrontmatter: true }).trim();

  const apiKeyNote = `\n\n${readSharedNote("api-key-setup.mdx")}`;
  const cliNote = `\n${readSharedNote("cli-install.mdx")}\n`;

  return `${header}${apiKeyNote}${cliNote}\n${combined}`;
}

function parseArgs(): CompileOptions {
  const args = process.argv.slice(2);
  let skills: string[] = [];
  let mode: CompileMode = "docs";
  let apiKey: string | undefined;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--skills":
        skills = args[++i]!.split(",");
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
  tsx compile.ts --skills tracing --mode platform --api-key sk-lw-xxx
  tsx compile.ts --skills level-up --mode docs
  tsx compile.ts --skills tracing,scenarios --mode platform`);
        process.exit(0);
    }
  }

  if (skills.length === 0) {
    console.error("Error: --skills is required. Use --help for usage.");
    process.exit(1);
  }

  return { skills, mode, apiKey };
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const options = parseArgs();
  const result = compile(options);
  console.log(result);
}
