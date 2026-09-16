#!/usr/bin/env npx tsx
/**
 * Native skill generator: emits opencode-discoverable SKILL.md files,
 * verbatim, for the langyagent image (in-product nuances live in AGENTS.md).
 * Recipes flatten one level deep — see skills/_compiled/README.md for the pipeline.
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
 * Setup partials the in-product agent must not be given: it already has
 * credentials, endpoint and CLI on PATH, so these are instructions to ignore
 * something, priced at every token spent reading them regardless.
 */
const LANGY_EXCLUDED_PARTIALS = ["cli-setup", "projects-and-api-keys"];

export function renderSkill(skill: PublishedSkill): string {
  if (!fs.existsSync(skill.src)) {
    throw new Error(`Skill source not found: ${skill.src}`);
  }
  return inlineMdx(skill.src, { excludeShared: LANGY_EXCLUDED_PARTIALS });
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
