#!/usr/bin/env npx tsx
/**
 * Native skill generator.
 *
 * Emits opencode-discoverable SKILL.md files for the langyagent image from the
 * canonical skills/<name>/SKILL.mdx sources. Public entries are the same files
 * skills/_publish/sync.ts publishes; Langy-only entries remain native.
 *
 * The SET is whatever listNativeSkills() reports: everything public plus the
 * Langy-only skills whose canonical sources also live under root skills/. The
 * publisher continues to use listPublishedSkills(), so internal capabilities
 * do not leak into the public directory. Recipes are flattened to top-level
 * dirs because opencode discovers skills one level deep
 * ($HOME/.config/opencode/skills/<name>/SKILL.md).
 *
 * The CONTENT is the canonical skill, verbatim: inlineMdx preserves frontmatter
 * (name + description → opencode discovery) and inlines shared partials. We do
 * NOT rewrite bodies. In-product nuances (the worker already has credentials +
 * the CLI) live as a single global override in AGENTS.md.
 *
 * Output is COMMITTED (unlike the gitignored skills/_compiled/*.txt prompts):
 * Dockerfile.langyagent COPYs skills/_compiled/native/ into the manager's
 * go:embed dir at image build, so the checked-in tree is exactly what ships.
 * Regenerate via skills/_compiled/generate.sh after any SKILL.mdx change.
 *
 * Usage:  tsx skills/_compiler/native.ts [--out <dir>]
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { inlineMdx } from "../_lib/mdx-inline.js";
import {
  listNativeSkills,
  listPublishedSkills,
  type PublishedSkill,
} from "../_lib/feature-skills.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const skillsRoot = path.resolve(__dirname, "..");
const DEFAULT_OUT = path.join(skillsRoot, "_compiled", "native");

// Render one canonical skill into opencode SKILL.md text — frontmatter + body,
// using the same renderer as the public publisher.
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
  const skills = listNativeSkills(skillsRoot);
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

export { listNativeSkills, listPublishedSkills };
