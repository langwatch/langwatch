import fs from "fs";
import path from "path";

import { splitFrontmatter } from "./frontmatter.ts";

// The curated, top-level skill set — the skills shown on the public directory
// (https://langwatch.ai/docs/skills/directory). Adding one here is the one-line
// gate that publishes it (and, via listNativeSkills below, gives it to Langy
// too). Recipes are NOT listed here; they are auto-discovered.
export const FEATURE_SKILLS = [
  "tracing",
  "experiments",
  "online-evaluations",
  "evaluations",
  "scenarios",
  "connect-agent",
  "prompts",
  "agent-performance",
  "agent-improve",
  "level-up",
  "datasets",
  "context-sweet-spot",
  "provider-cost-comparison",
  "coding-agent-cost",
] as const;

// Skills that ship only with Langy. Their canonical sources still live at the
// repository root so Docker and catalogue generation need no service-internal
// input, but they are deliberately excluded from the public publisher.
export const NATIVE_ONLY_SKILLS = [
  "github",
  "prompt-optimization",
  "drive-the-ui",
  "code-changes",
  "guided-onboarding",
  "automations",
  "daily-insights",
] as const;

export interface PublishedSkill {
  slug: string; // unique skill name
  src: string; // absolute path to the canonical SKILL.mdx
  isRecipe: boolean; // recipes publish nested under recipes/<slug>; Langy flattens them
  // The feature flag gating this skill's offer, read from its own
  // `feature-flag` front-matter. Absent = always offered. Every consumer of
  // this list reads it from here rather than re-parsing frontmatter itself,
  // so a skill's gate can only ever drift by editing its own SKILL.mdx.
  featureFlag?: string;
}

/** Reads a skill's `feature-flag` front-matter key, if it declares one. */
function featureFlagOf(src: string): string | undefined {
  if (!fs.existsSync(src)) return undefined;
  const { frontmatter } = splitFrontmatter(fs.readFileSync(src, "utf8"));
  return frontmatter["feature-flag"];
}

// The single definition of the public set: curated FEATURE_SKILLS plus every
// recipe under skills/recipes/. The native set below extends this, so
// everything published also ships with Langy while product-only stays private.
// A flagged recipe still appears here — Langy resolves the flag live per
// caller; only the PUBLIC publish step filters on `featureFlag`.
export function listPublishedSkills(skillsRoot: string): PublishedSkill[] {
  const out: PublishedSkill[] = FEATURE_SKILLS.map((slug) => {
    const src = path.join(skillsRoot, slug, "SKILL.mdx");
    return { slug, src, isRecipe: false, featureFlag: featureFlagOf(src) };
  });

  const recipesDir = path.join(skillsRoot, "recipes");
  if (fs.existsSync(recipesDir)) {
    const names = fs
      .readdirSync(recipesDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .toSorted(); // deterministic output across machines
    for (const name of names) {
      const src = path.join(recipesDir, name, "SKILL.mdx");
      if (fs.existsSync(src)) {
        out.push({
          slug: name,
          src,
          isRecipe: true,
          featureFlag: featureFlagOf(src),
        });
      }
    }
  }
  return out;
}

/** Folders and files a local install or test run leaves in a skill folder. */
const LEFTOVER_PARTS = new Set(["__pycache__", "node_modules", "coverage", "dist"]);
const LOCKFILES = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
  "bun.lock",
  "uv.lock",
  "poetry.lock",
  "Pipfile.lock",
]);

/** False for leftovers: dot paths, caches, installs, coverage, build output and lockfiles. */
export function isShippableAsset(rel: string): boolean {
  const parts = rel.split(/[\\/]/);
  return (
    !LOCKFILES.has(parts.at(-1) ?? "") &&
    parts.every(
      (part) => !part.startsWith(".") && !LEFTOVER_PARTS.has(part) && !part.endsWith(".pyc"),
    )
  );
}

/**
 * Files a skill ships beside its SKILL.md (templates a coding agent copies),
 * as sorted paths relative to the skill's folder. Every consumer copies them.
 */
export function listSkillAssets(skill: PublishedSkill): string[] {
  const dir = path.dirname(skill.src);
  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => path.relative(dir, path.join(e.parentPath, e.name)))
    .filter((rel) => rel !== "SKILL.mdx" && isShippableAsset(rel))
    .toSorted();
}

/** Copies a skill's assets into the folder its SKILL.md was written to. */
export function copySkillAssets({ skill, toDir }: { skill: PublishedSkill; toDir: string }): void {
  const fromDir = path.dirname(skill.src);
  for (const rel of listSkillAssets(skill)) {
    fs.mkdirSync(path.dirname(path.join(toDir, rel)), { recursive: true });
    fs.copyFileSync(path.join(fromDir, rel), path.join(toDir, rel));
  }
}

export function listNativeSkills(skillsRoot: string): PublishedSkill[] {
  return [
    ...listPublishedSkills(skillsRoot),
    ...NATIVE_ONLY_SKILLS.map((slug) => {
      const src = path.join(skillsRoot, slug, "SKILL.mdx");
      return { slug, src, isRecipe: false, featureFlag: featureFlagOf(src) };
    }),
  ];
}
