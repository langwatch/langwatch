import fs from "fs";
import path from "path";

import { splitFrontmatter } from "./frontmatter.js";

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
] as const;

// Skills that ship only with Langy. Their canonical sources still live at the
// repository root so Docker and catalogue generation need no service-internal
// input, but they are deliberately excluded from the public publisher.
export const NATIVE_ONLY_SKILLS = [
  "github",
  "prompt-optimization",
  "drive-the-ui",
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
// recipe under skills/recipes/. The native set below extends this, so everything
// published also ships with Langy while product-only capabilities stay private.
//
// A recipe declaring `feature-flag` still appears here — the native/Langy
// pipeline needs its content regardless, since Langy resolves the flag live,
// per caller, at offer time. The PUBLIC publish step (`_publish/sync.ts`) is
// the one place that must NOT ship a flag-gated recipe: there is no viewer to
// gate for on a static public directory, so it filters on `featureFlag`
// itself rather than this function silently dropping the skill everywhere.
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
			.sort(); // deterministic output across machines
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

export function listNativeSkills(skillsRoot: string): PublishedSkill[] {
	return [
		...listPublishedSkills(skillsRoot),
		...NATIVE_ONLY_SKILLS.map((slug) => {
			const src = path.join(skillsRoot, slug, "SKILL.mdx");
			return { slug, src, isRecipe: false, featureFlag: featureFlagOf(src) };
		}),
	];
}
