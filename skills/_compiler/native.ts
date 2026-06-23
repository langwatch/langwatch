#!/usr/bin/env npx tsx
/**
 * Native skill generator.
 *
 * Emits opencode-discoverable SKILL.md files for the langy-agent image from the
 * canonical skills/<name>/SKILL.mdx sources — the SAME files skills/_publish/
 * sync.ts publishes to langwatch/skills and the docs directory lists.
 *
 * Content is the PUBLISHED skill, verbatim: inlineMdx preserves the frontmatter
 * (name + description → opencode discovery) and inlines the shared partials,
 * producing byte-identical output to sync.ts's writeSkill. We do NOT rewrite the
 * bodies. In-product nuances (the worker already has credentials + the CLI) live
 * as a single global override in AGENTS.md, so what Langy loads is exactly what
 * we publish.
 *
 * The set is restricted to the published FEATURE_SKILLS — internal recipes are
 * excluded, matching the public directory.
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
import { FEATURE_SKILLS } from "../_lib/feature-skills.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const skillsRoot = path.resolve(__dirname, "..");
const DEFAULT_OUT = path.join(skillsRoot, "_compiled", "native");

// Render one published skill into opencode SKILL.md text — frontmatter + body,
// verbatim from the canonical source (same rendering sync.ts publishes).
export function renderSkill(slug: string): string {
  const src = path.join(skillsRoot, slug, "SKILL.mdx");
  if (!fs.existsSync(src)) {
    throw new Error(`Skill not found: ${slug} (looked at ${src})`);
  }
  return inlineMdx(src);
}

function main() {
  const args = process.argv.slice(2);
  let outDir = DEFAULT_OUT;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--out") outDir = path.resolve(args[++i]!);
  }
  fs.rmSync(outDir, { recursive: true, force: true });
  for (const slug of FEATURE_SKILLS) {
    const dir = path.join(outDir, slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "SKILL.md"), renderSkill(slug));
  }
  console.log(`Generated ${FEATURE_SKILLS.length} native skills in ${outDir}/`);
  for (const slug of FEATURE_SKILLS) console.log(`  - ${slug}`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) main();

export { FEATURE_SKILLS };
