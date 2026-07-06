import fs from "fs";
import path from "path";

// The curated, top-level skill set — the skills shown on the public directory
// (https://langwatch.ai/docs/skills/directory). Adding one here is the one-line
// gate that publishes it (and, via listPublishedSkills below, gives it to Langy
// too). Recipes are NOT listed here; they are auto-discovered.
export const FEATURE_SKILLS = [
  "tracing",
  "evaluations",
  "scenarios",
  "prompts",
  "analytics",
  "level-up",
  "datasets",
] as const;

export interface PublishedSkill {
  slug: string; // unique skill name
  src: string; // absolute path to the canonical SKILL.mdx
  isRecipe: boolean; // recipes publish nested under recipes/<slug>; Langy flattens them
}

// The SINGLE definition of "our skills": the curated FEATURE_SKILLS plus every
// recipe under skills/recipes/. Both the publisher (skills/_publish/sync.ts) and
// the langy-agent generator (skills/_compiler/native.ts) read this, so Langy can
// never carry a different SET than what we publish. A new recipe folder flows to
// both automatically; a new feature skill is one edit to FEATURE_SKILLS that
// both pick up.
export function listPublishedSkills(skillsRoot: string): PublishedSkill[] {
  const out: PublishedSkill[] = FEATURE_SKILLS.map((slug) => ({
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
