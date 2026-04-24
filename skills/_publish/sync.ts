#!/usr/bin/env npx tsx
/**
 * Sync SKILL.md files from this repo into a checkout of langwatch/skills,
 * inlining `_shared/*.md` partials so the published files are self-contained.
 *
 * Usage: npx tsx skills/_publish/sync.ts <path-to-skills-repo>
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { resolveReferences } from "../_compiler/compile.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const skillsRoot = path.resolve(__dirname, "..");

const FEATURE_SKILLS = [
  "tracing",
  "evaluations",
  "scenarios",
  "prompts",
  "analytics",
  "level-up",
];

function splitFrontmatter(content: string): { frontmatter: string; body: string } {
  const m = content.match(/^(---\n[\s\S]*?\n---\n)([\s\S]*)$/);
  if (!m) throw new Error("Missing frontmatter");
  return { frontmatter: m[1], body: m[2] };
}

function inlineSkill(srcPath: string): string {
  const raw = fs.readFileSync(srcPath, "utf8");
  const { frontmatter, body } = splitFrontmatter(raw);
  const resolved = resolveReferences(body, path.dirname(srcPath), new Set());
  return frontmatter + resolved;
}

function cleanTarget(targetDir: string): void {
  for (const entry of fs.readdirSync(targetDir)) {
    if (entry === ".git") continue;
    fs.rmSync(path.join(targetDir, entry), { recursive: true, force: true });
  }
}

function writeSkill(targetDir: string, name: string, content: string): void {
  const dir = path.join(targetDir, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), content);
}

export function sync(targetDir: string): void {
  if (!fs.existsSync(targetDir)) {
    throw new Error(`Target dir does not exist: ${targetDir}`);
  }
  console.log(`Syncing skills to ${targetDir}...`);
  cleanTarget(targetDir);

  for (const skill of FEATURE_SKILLS) {
    const src = path.join(skillsRoot, skill, "SKILL.md");
    if (!fs.existsSync(src)) continue;
    writeSkill(targetDir, skill, inlineSkill(src));
    console.log(`  ✓ ${skill}`);
  }

  const recipesDir = path.join(skillsRoot, "recipes");
  if (fs.existsSync(recipesDir)) {
    for (const name of fs.readdirSync(recipesDir)) {
      const src = path.join(recipesDir, name, "SKILL.md");
      if (!fs.existsSync(src)) continue;
      writeSkill(targetDir, path.join("recipes", name), inlineSkill(src));
      console.log(`  ✓ recipes/${name}`);
    }
  }

  fs.copyFileSync(
    path.join(skillsRoot, "version.txt"),
    path.join(targetDir, "version.txt")
  );
  console.log("  ✓ version.txt");
  console.log("Done.");
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const target = process.argv[2];
  if (!target) {
    console.error("Usage: sync.ts <path-to-skills-repo>");
    process.exit(1);
  }
  sync(target);
}
