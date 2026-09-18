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

/**
 * Setup partials the in-product agent must not be given.
 *
 * Both tell a reader how to reach a LangWatch project from the outside. The
 * worker is already inside one: it boots with its credentials, its endpoint and
 * the CLI on PATH, and AGENTS.md tells it to skip a skill's setup steps. So the
 * sections are instructions to ignore something, priced at every token spent
 * reading them, across every skill that imports them.
 *
 * They stay in the published and docs builds, where the reader really does have
 * to install a CLI and find an API key.
 */
const LANGY_EXCLUDED_PARTIALS = ["cli-setup", "projects-and-api-keys"];

export function renderSkill(skill: PublishedSkill): string {
  if (!fs.existsSync(skill.src)) {
    throw new Error(`Skill source not found: ${skill.src}`);
  }
  return inlineMdx(skill.src, { excludeShared: LANGY_EXCLUDED_PARTIALS });
}

/**
 * Copy a skill's sibling `recipes/` tree verbatim next to its SKILL.md.
 *
 * SKILL.md is the only file the compiler inlines; a skill whose walkthrough is
 * too large to live in one prompt (the beautiful-dashboards board recipes:
 * dozens of widget.tsx + queries.json pairs) instead ships the per-item files
 * beside it and points the reader at them by path. The agent loads the tight
 * SKILL.md, then opens one recipe file at a time — the same file-per-item shape
 * the north-star widgets use — rather than carrying every board in context.
 *
 * Only a `recipes/` subdirectory travels, and only when one exists, so every
 * other skill's output is byte-for-byte unchanged.
 */
function copyRecipeAssets(skill: PublishedSkill, outDir: string): void {
  const recipesSrc = path.join(path.dirname(skill.src), "recipes");
  if (!fs.existsSync(recipesSrc)) return;
  fs.cpSync(recipesSrc, path.join(outDir, "recipes"), { recursive: true });
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
    copyRecipeAssets(skill, dir);
  }
  console.log(`Generated ${skills.length} native skills in ${outDir}/`);
  for (const skill of skills) {
    console.log(`  - ${skill.slug}${skill.isRecipe ? " (recipe)" : ""}`);
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) main();

export { listNativeSkills, listPublishedSkills };
