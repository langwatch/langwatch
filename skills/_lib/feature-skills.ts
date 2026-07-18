import fs from "fs";
import path from "path";

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
  "prompts",
  "agent-performance",
  "agent-improve",
  "level-up",
  "datasets",
] as const;

// Skills that ship only with Langy. Their canonical sources still live at the
// repository root so Docker and catalogue generation need no service-internal
// input, but they are deliberately excluded from the public publisher.
export const NATIVE_ONLY_SKILLS = ["github"] as const;

export interface PublishedSkill {
  slug: string; // unique skill name
  src: string; // absolute path to the canonical SKILL.mdx
  isRecipe: boolean; // recipes publish nested under recipes/<slug>; Langy flattens them
}

// The single definition of the public set: curated FEATURE_SKILLS plus every
// recipe under skills/recipes/. The native set below extends this, so everything
// published also ships with Langy while product-only capabilities stay private.
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

export function listNativeSkills(skillsRoot: string): PublishedSkill[] {
  return [
    ...listPublishedSkills(skillsRoot),
    ...NATIVE_ONLY_SKILLS.map((slug) => ({
      slug,
      src: path.join(skillsRoot, slug, "SKILL.mdx"),
      isRecipe: false,
    })),
  ];
}
