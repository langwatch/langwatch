#!/usr/bin/env npx tsx
/**
 * Native skill generator.
 *
 * Emits opencode-discoverable SKILL.md files for the langy-agent image from the
 * canonical skills/<name>/SKILL.mdx sources — the SAME files skills/_publish/
 * sync.ts publishes to langwatch/skills.
 *
 * The SET is whatever listPublishedSkills() reports — the curated FEATURE_SKILLS
 * plus every recipe under skills/recipes/ — the exact same selection the
 * publisher uses, so Langy always carries what we publish (see
 * skills/_lib/feature-skills.ts). Recipes are flattened to top-level dirs here
 * because opencode discovers skills one level deep ($HOME/.config/opencode/
 * skills/<name>/SKILL.md).
 *
 * The CONTENT is the published skill, verbatim: inlineMdx preserves frontmatter
 * (name + description → opencode discovery) and inlines shared partials. We do
 * NOT rewrite bodies. In-product nuances (the worker already has credentials +
 * the CLI) live as a single global override in AGENTS.md.
 *
 * Output (committed, like skills/_compiled/*.txt) is consumed by the langy-agent
 * image at build time. Regenerate via skills/_compiled/generate.sh.
 *
 * Usage:  tsx skills/_compiler/native.ts [--out <dir>]
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { inlineMdx } from "../_lib/mdx-inline.js";
import { listPublishedSkills, type PublishedSkill } from "../_lib/feature-skills.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const skillsRoot = path.resolve(__dirname, "..");
const DEFAULT_OUT = path.join(skillsRoot, "_compiled", "native");

// Render one published skill into opencode SKILL.md text — frontmatter + body,
// verbatim from the canonical source (same rendering sync.ts publishes).
export function renderSkill(skill: PublishedSkill): string {
  if (!fs.existsSync(skill.src)) {
    throw new Error(`Skill source not found: ${skill.src}`);
  }
  return inlineMdx(skill.src);
}

function main() {
  const args = process.argv.slice(2);
  let outDir = DEFAULT_OUT;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--out") outDir = path.resolve(args[++i]!);
  }
  const skills = listPublishedSkills(skillsRoot);
  fs.rmSync(outDir, { recursive: true, force: true });
  for (const skill of skills) {
    const dir = path.join(outDir, skill.slug); // flattened — recipes included
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "SKILL.md"), renderSkill(skill));
  }
  console.log(`Generated ${skills.length} native skills in ${outDir}/`);
  for (const skill of skills) {
    console.log(`  - ${skill.slug}${skill.isRecipe ? " (recipe)" : ""}`);
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) main();

export { listPublishedSkills };
