#!/usr/bin/env node
/**
 * Native skill generator: verbatim opencode SKILL.md files for the langyagent image,
 * or with `--target cli` the variant the CLI's `langwatch skills` bundle embeds.
 * Recipes flatten one level deep — see skills/_compiled/README.md for the pipeline.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import {
  listNativeSkills,
  listPublishedSkills,
  type PublishedSkill,
} from "../_lib/feature-skills.ts";
import { inlineMdx } from "../_lib/mdx-inline.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const skillsRoot = path.resolve(__dirname, "..");

/**
 * Setup partials both renders leave out: both readers already run the CLI with
 * credentials available, so install and key-setup steps are moot.
 */
const ALWAYS_EXCLUDED_PARTIALS = ["cli-setup", "projects-and-api-keys"];

/**
 * Login partials: Langy already holds a key, so they would have it tell a
 * signed-in user to log in or set a key. A CLI user still has to log in.
 */
const LOGIN_PARTIALS = [
  "cli-login",
  "cli-login-intro",
  "cli-login-troubleshooting",
  "coding-agent-cost-login",
  "context-sweet-spot-login",
  "provider-cost-comparison-login",
];

/** Which reader a render is for: Langy's image, or the CLI's embedded bundle. */
export type NativeTarget = "langy" | "cli";

const TARGETS: Record<
  NativeTarget,
  { excluded: string[]; list: (skillsRoot: string) => PublishedSkill[]; outDir: string }
> = {
  langy: {
    excluded: [...ALWAYS_EXCLUDED_PARTIALS, ...LOGIN_PARTIALS],
    list: listNativeSkills,
    outDir: path.join(skillsRoot, "_compiled", "native"),
  },
  cli: {
    excluded: ALWAYS_EXCLUDED_PARTIALS,
    list: listPublishedSkills,
    outDir: path.join(skillsRoot, "_compiled", "cli"),
  },
};

/** Renders one skill to a self-contained SKILL.md for the given target (Langy by default). */
export function renderSkill(skill: PublishedSkill, target: NativeTarget = "langy"): string {
  if (!fs.existsSync(skill.src)) {
    throw new Error(`Skill source not found: ${skill.src}`);
  }
  return inlineMdx(skill.src, { excludeShared: TARGETS[target].excluded });
}

/** The skills a target ships, and the committed directory its renders live in. */
export function targetOutput(target: NativeTarget): { skills: PublishedSkill[]; outDir: string } {
  return { skills: TARGETS[target].list(skillsRoot), outDir: TARGETS[target].outDir };
}

function main() {
  const args = process.argv.slice(2);
  let target: NativeTarget = "langy";
  let outOverride: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--out") outOverride = path.resolve(args[++i]!);
    if (args[i] === "--target") {
      const value = args[++i];
      if (value !== "langy" && value !== "cli") {
        throw new Error(`--target must be "langy" or "cli", got ${value}`);
      }
      target = value;
    }
  }
  const { skills, outDir: defaultOut } = targetOutput(target);
  const outDir = outOverride ?? defaultOut;
  fs.rmSync(outDir, { recursive: true, force: true });
  for (const skill of skills) {
    const dir = path.join(outDir, skill.slug); // flattened — recipes included
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "SKILL.md"), renderSkill(skill, target));
  }
  console.log(`Generated ${skills.length} ${target} skills in ${outDir}/`);
  for (const skill of skills) {
    console.log(`  - ${skill.slug}${skill.isRecipe ? " (recipe)" : ""}`);
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) main();

export { listNativeSkills, listPublishedSkills };
