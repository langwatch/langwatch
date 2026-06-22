#!/usr/bin/env npx tsx
/**
 * Native skill generator.
 *
 * Emits opencode-discoverable `SKILL.md` files from the canonical
 * `skills/<name>/SKILL.mdx` sources — the SAME sources behind the public skill
 * directory (https://langwatch.ai/docs/skills/directory) — so the Langy
 * in-product assistant loads exactly what we publish, with no hand-maintained
 * copy that can drift.
 *
 * How this differs from the docs/platform compiler (compile.ts):
 *   - One SKILL.md per skill: no `level-up` expansion, no multi-skill compose.
 *   - Frontmatter (name + description) is PRESERVED — opencode discovers and
 *     lists skills by it, then loads the body on demand via its `skill` tool.
 *   - No "ask the user for an API key" / "npm install the CLI" scaffolding:
 *     the worker already has credentials in its env and the CLI baked into the
 *     image. The api-key/cli-install notes compile.ts injects are simply never
 *     added here, and the one shared partial that embeds the ask
 *     (projects-and-api-keys.mdx) is swapped for its in-product variant.
 *
 * Output (committed, like skills/_compiled/*.txt) is consumed by the
 * langy-agent image at build time. Regenerate via skills/_compiled/generate.sh.
 *
 * Usage:  tsx skills/_compiler/native.ts [--out <dir>]
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { inlineMdx } from "../_lib/mdx-inline.js";
import { splitFrontmatter } from "../_lib/frontmatter.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const skillsRoot = path.resolve(__dirname, "..");
const DEFAULT_OUT = path.join(skillsRoot, "_compiled", "native");

// Canonical partials whose wording assumes an external, unauthenticated setup
// are swapped for in-product variants. Keyed by basename; resolved in the same
// `_shared/` directory (see mdx-inline.ts partialOverrides).
const PARTIAL_OVERRIDES: Record<string, string> = {
  "projects-and-api-keys.mdx": "projects-and-api-keys.native.mdx",
};

export interface DiscoveredSkill {
  slug: string; // opencode skill name AND output directory name
  sourcePath: string; // absolute path to the canonical SKILL.mdx
}

// Discover every canonical skill: top-level skill dirs plus recipe dirs.
// Discovery (not a hardcoded list) is what makes "add a skill to the directory
// and Langy gets it" true with no extra wiring.
export function discoverSkills(): DiscoveredSkill[] {
  const out: DiscoveredSkill[] = [];
  const addIfSkill = (dir: string) => {
    const source = path.join(dir, "SKILL.mdx");
    if (!fs.existsSync(source)) return;
    const { frontmatter } = splitFrontmatter(fs.readFileSync(source, "utf8"));
    out.push({ slug: frontmatter.name ?? path.basename(dir), sourcePath: source });
  };
  for (const entry of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith("_")) continue;
    if (entry.name === "recipes") {
      const recipesDir = path.join(skillsRoot, "recipes");
      for (const r of fs.readdirSync(recipesDir, { withFileTypes: true })) {
        if (r.isDirectory()) addIfSkill(path.join(recipesDir, r.name));
      }
      continue;
    }
    addIfSkill(path.join(skillsRoot, entry.name));
  }
  return out.sort((a, b) => a.slug.localeCompare(b.slug));
}

// Render one canonical skill into opencode SKILL.md text: minimal frontmatter
// (name + description) plus the in-product-rendered body.
export function renderSkill(skill: DiscoveredSkill): string {
  const { frontmatter } = splitFrontmatter(fs.readFileSync(skill.sourcePath, "utf8"));
  const description = frontmatter.description;
  if (!description) {
    throw new Error(`${skill.sourcePath}: frontmatter is missing required "description"`);
  }
  const body = inlineMdx(skill.sourcePath, {
    stripFrontmatter: true,
    partialOverrides: PARTIAL_OVERRIDES,
  }).trim();
  // A JSON string literal is also a valid YAML double-quoted scalar — the
  // safest way to emit a one-line description that may contain colons, quotes,
  // or backticks without hand-rolling YAML escaping.
  return `---\nname: ${skill.slug}\ndescription: ${JSON.stringify(description)}\n---\n\n${body}\n`;
}

function main() {
  const args = process.argv.slice(2);
  let outDir = DEFAULT_OUT;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--out") outDir = path.resolve(args[++i]!);
  }
  const skills = discoverSkills();
  fs.rmSync(outDir, { recursive: true, force: true });
  for (const skill of skills) {
    const dir = path.join(outDir, skill.slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "SKILL.md"), renderSkill(skill));
  }
  console.log(`Generated ${skills.length} native skills in ${outDir}/`);
  for (const s of skills) console.log(`  - ${s.slug}`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) main();
