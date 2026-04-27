#!/usr/bin/env npx tsx
/**
 * Sync SKILL.mdx files into a checkout of langwatch/skills, inlining MDX
 * partials so the published .md files are self-contained.
 *
 * Usage: tsx skills/_publish/sync.ts <path-to-skills-repo>
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { inlineMdx } from "../_lib/mdx-inline.js";

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

function cleanTarget(targetDir: string): void {
  for (const entry of fs.readdirSync(targetDir)) {
    if (entry === ".git") continue;
    fs.rmSync(path.join(targetDir, entry), { recursive: true, force: true });
  }
}

function writeSkill(targetDir: string, name: string, src: string): void {
  const dir = path.join(targetDir, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), inlineMdx(src));
}

export function sync(targetDir: string): void {
  if (!fs.existsSync(targetDir)) {
    throw new Error(`Target dir does not exist: ${targetDir}`);
  }
  if (!fs.existsSync(path.join(targetDir, ".git"))) {
    // Fail fast before the destructive wipe — a missing .git means the target
    // is not a checkout of langwatch/skills (silent CI checkout failure, wrong
    // path, typo). The workflow has its own guard but it runs after sync.
    throw new Error(
      `Refusing to sync into ${targetDir}: no .git directory. ` +
        `Target must be a checkout of langwatch/skills.`
    );
  }
  console.log(`Syncing skills to ${targetDir}...`);
  cleanTarget(targetDir);

  for (const skill of FEATURE_SKILLS) {
    const src = path.join(skillsRoot, skill, "SKILL.mdx");
    if (!fs.existsSync(src)) continue;
    writeSkill(targetDir, skill, src);
    console.log(`  ✓ ${skill}`);
  }

  const recipesDir = path.join(skillsRoot, "recipes");
  if (fs.existsSync(recipesDir)) {
    for (const name of fs.readdirSync(recipesDir)) {
      const src = path.join(recipesDir, name, "SKILL.mdx");
      if (!fs.existsSync(src)) continue;
      writeSkill(targetDir, path.join("recipes", name), src);
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
