#!/usr/bin/env node
/**
 * Embed the published LangWatch agent skills into the CLI as a generated TS
 * module — `langwatch skills list/get/install/…` reads no files at runtime,
 * so the bundle survives both the tsup build and the bun single-binary build.
 *
 * The bodies come from the COMMITTED `skills/_compiled/native/<slug>/SKILL.md`
 * files — not from re-inlining the MDX sources here. Those files are rendered
 * by `skills/_compiler/native.ts` with the very same `inlineMdx` the public
 * publisher (`skills/_publish/sync.ts`) uses, and `skills/_tests/
 * native-skills.test.ts` pins them to the sources. Reading them means this
 * script needs zero workspace dependencies (copy-types.sh runs on every SDK
 * `pnpm install`/`pnpm build`, where the skills workspace may not be
 * installed) AND the bundle can never drift from what Langy ships or what
 * `npx skills add langwatch/skills` installs: one rendered artifact, three
 * consumers. The native set flattens recipes to top-level dirs; the bundle
 * re-nests them via `isRecipe` from the published-set listing.
 *
 * The published set + frontmatter metadata (name/description/user-prompt)
 * still come from the canonical sources, exactly as the publisher reads
 * them. NATIVE_ONLY skills (github) are excluded — they ship with Langy only.
 *
 * Usage: node scripts/generate-skills-bundle.mjs   (from copy-types.sh)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sdkRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillsRoot = path.resolve(sdkRoot, "..", "skills");
const nativeRoot = path.join(skillsRoot, "_compiled", "native");
const outPath = path.join(
  sdkRoot,
  "src/internal/generated/cli/skills.generated.ts",
);

// --- The published set -------------------------------------------------------
// Read FEATURE_SKILLS from skills/_lib/feature-skills.ts rather than
// duplicating the list: it is the single source of truth for what is public.
// The file is TypeScript but the declaration is a plain string array, which a
// regex reads fine — a failure here means the file changed shape, and that
// SHOULD break the build rather than silently ship a stale skill set.
function listFeatureSkills() {
  const src = fs.readFileSync(
    path.join(skillsRoot, "_lib/feature-skills.ts"),
    "utf8",
  );
  const match = src.match(/export const FEATURE_SKILLS = \[([\s\S]*?)\] as const;/);
  if (!match) {
    throw new Error(
      "Could not find `export const FEATURE_SKILLS = [...] as const;` in skills/_lib/feature-skills.ts",
    );
  }
  return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

function listPublishedSkills() {
  const out = listFeatureSkills().map((slug) => ({
    slug,
    src: path.join(skillsRoot, slug, "SKILL.mdx"),
    isRecipe: false,
  }));
  const recipesDir = path.join(skillsRoot, "recipes");
  if (fs.existsSync(recipesDir)) {
    const names = fs
      .readdirSync(recipesDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort(); // deterministic output across machines
    for (const name of names) {
      const src = path.join(recipesDir, name, "SKILL.mdx");
      if (fs.existsSync(src)) out.push({ slug: name, src, isRecipe: true });
    }
  }
  return out;
}

// --- Frontmatter -------------------------------------------------------------
// Same minimal reader as skills/_lib/frontmatter.ts: top-level single-line
// `key: value` pairs between the `---` fences.
function splitFrontmatter(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return { frontmatter: {}, body: raw };
  const fm = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^(\w[\w-]*?):\s*(.+)$/);
    if (!kv) continue;
    const value = kv[2].trim();
    // A YAML block/folded scalar (`description: >-`, `: |`, `: >2`) puts the
    // real value on the following INDENTED lines, which this single-line
    // reader never sees — it would capture the literal ">-" instead. The
    // `if (!description) throw` guard downstream cannot catch that, because
    // ">-" is perfectly truthy: the bundle would ship, with every agent
    // reading ">-" as the skill's description. Fail here, loudly, instead.
    if (/^[>|][-+0-9]*$/.test(value)) {
      throw new Error(
        `Frontmatter key "${kv[1]}" uses a YAML block scalar ("${value}"), which this minimal reader cannot parse.\n` +
          `Rewrite it as a single-line "${kv[1]}: value" (quote the value if it contains a colon).`,
      );
    }
    fm[kv[1]] = value;
  }
  return { frontmatter: fm, body: m[2] };
}

// --- Bundle ------------------------------------------------------------------
const version = fs
  .readFileSync(path.join(skillsRoot, "version.txt"), "utf8")
  .trim();

const skills = listPublishedSkills().map(({ slug, src, isRecipe }) => {
  if (!fs.existsSync(src)) {
    throw new Error(`Published skill ${slug} has no SKILL.mdx at ${src}`);
  }
  // The body is the committed native render (recipes are flattened there).
  // Missing means the sources changed without regenerating — say so loudly,
  // with the fix, rather than shipping a stale or half-empty bundle.
  const nativePath = path.join(nativeRoot, slug, "SKILL.md");
  if (!fs.existsSync(nativePath)) {
    throw new Error(
      `No compiled native skill for ${slug} at ${path.relative(process.cwd(), nativePath)}.\n` +
        `Regenerate from the repo root: bash skills/_compiled/generate.sh`,
    );
  }
  const { frontmatter } = splitFrontmatter(fs.readFileSync(src, "utf8"));
  const description = frontmatter.description;
  if (!description) {
    throw new Error(`Skill ${slug} has no description in its frontmatter`);
  }
  const userPrompt = frontmatter["user-prompt"]?.replace(/^["']|["']$/g, "");
  return {
    slug,
    name: frontmatter.name ?? slug,
    description,
    ...(userPrompt ? { userPrompt } : {}),
    isRecipe,
    body: fs.readFileSync(nativePath, "utf8"),
  };
});

const header = [
  "// Generated by copy-types.sh (scripts/generate-skills-bundle.mjs) from",
  "// skills/_compiled/native/ (committed, rendered by skills/_compiler/native.ts).",
  "// Do not edit by hand — re-runs on every SDK install/build.",
  "",
  "/** One published skill, fully inlined (MDX partials resolved) and ready to write as SKILL.md. */",
  "export interface BundledSkill {",
  "  /** Unique skill name; recipes install nested under recipes/<slug>. */",
  "  slug: string;",
  "  name: string;",
  "  description: string;",
  "  userPrompt?: string;",
  "  isRecipe: boolean;",
  "  /** The full self-contained SKILL.md content, frontmatter included. */",
  "  body: string;",
  "}",
  "",
].join("\n");

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(
  outPath,
  header +
    `export const SKILLS_BUNDLE_VERSION = ${JSON.stringify(version)};\n\n` +
    `export const SKILLS_BUNDLE: BundledSkill[] = ${JSON.stringify(skills, null, 2)};\n`,
);
console.log(
  `Wrote ${path.relative(sdkRoot, outPath)} (${skills.length} skills, bundle v${version})`,
);
