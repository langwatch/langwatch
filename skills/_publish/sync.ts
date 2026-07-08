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
import {
  listPublishedSkills,
  type PublishedSkill,
} from "../_lib/feature-skills.js";
import { splitFrontmatter } from "../_lib/frontmatter.js";
import {
  buildMarketplaceJson,
  buildPluginJson,
  buildReadme,
  type SkillEntry,
} from "./marketplace.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const skillsRoot = path.resolve(__dirname, "..");

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

function readDescription(src: string): string {
  const { frontmatter } = splitFrontmatter(fs.readFileSync(src, "utf8"));
  const description = frontmatter.description;
  if (!description) {
    throw new Error(`Skill has no frontmatter description: ${src}`);
  }
  return description;
}

// Emit the Claude Code plugin marketplace: a single `langwatch` plugin whose
// source is the repo root, its manifest, and a landing README. All three are
// derived from the same published set as the SKILL.md files above, so the
// marketplace can never drift from what we actually ship.
function writeMarketplace(
  targetDir: string,
  skills: PublishedSkill[],
  version: string
): void {
  const entries: SkillEntry[] = skills.map((s) => ({
    slug: s.slug,
    isRecipe: s.isRecipe,
    description: readDescription(s.src),
  }));

  const pluginDir = path.join(targetDir, ".claude-plugin");
  fs.mkdirSync(pluginDir, { recursive: true });

  const writeJson = (file: string, value: unknown): void =>
    fs.writeFileSync(path.join(pluginDir, file), JSON.stringify(value, null, 2) + "\n");

  writeJson("marketplace.json", buildMarketplaceJson(entries, version));
  writeJson("plugin.json", buildPluginJson(entries, version));
  fs.writeFileSync(path.join(targetDir, "README.md"), buildReadme(entries, version));

  console.log("  ✓ .claude-plugin/marketplace.json");
  console.log("  ✓ .claude-plugin/plugin.json");
  console.log("  ✓ README.md");
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

  // Same selection Langy's native generator uses (skills/_compiler/native.ts),
  // so the published set and the in-product set can never drift. Recipes nest
  // under recipes/<slug> in the published repo.
  const skills = listPublishedSkills(skillsRoot);
  for (const skill of skills) {
    const target = skill.isRecipe ? path.join("recipes", skill.slug) : skill.slug;
    writeSkill(targetDir, target, skill.src);
    console.log(`  ✓ ${target}`);
  }

  const version = fs
    .readFileSync(path.join(skillsRoot, "version.txt"), "utf8")
    .trim();
  fs.copyFileSync(
    path.join(skillsRoot, "version.txt"),
    path.join(targetDir, "version.txt")
  );
  console.log("  ✓ version.txt");

  writeMarketplace(targetDir, skills, version);
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
