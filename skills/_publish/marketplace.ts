/**
 * Builders for the Claude Code plugin marketplace that ships alongside the
 * published skills in langwatch/skills.
 *
 * The whole point is one source of truth: the SAME listPublishedSkills() set
 * that sync.ts writes as SKILL.md files also drives the marketplace's skill
 * list here, so the marketplace can never advertise a skill we didn't publish
 * (or miss one we did).
 *
 * Layout produced in the published repo:
 *
 *   .claude-plugin/
 *     marketplace.json   — the catalog: one `langwatch` plugin, source "."
 *     plugin.json        — the plugin manifest: metadata + enumerated skills
 *   <slug>/SKILL.md      — feature skills at the root
 *   recipes/<slug>/SKILL.md
 *
 * Users add it with `/plugin marketplace add langwatch/skills` and install with
 * `/plugin install langwatch@langwatch`.
 *
 * These builders are pure (no fs) so they unit-test without a checkout.
 */

export const MARKETPLACE_NAME = "langwatch";
export const PLUGIN_NAME = "langwatch";

const HOMEPAGE = "https://langwatch.ai/docs/skills/directory";
const REPOSITORY = "https://github.com/langwatch/skills";

const PLUGIN_DESCRIPTION =
  "Give your AI agent observability, evaluation, and optimization with LangWatch — tracing, experiments, simulations, prompt versioning, analytics, and synthetic datasets, driven by the langwatch CLI.";

const MARKETPLACE_DESCRIPTION =
  "Official LangWatch skills for AI agents — tracing, evaluations, scenarios, prompts, analytics, and datasets.";

const KEYWORDS = [
  "langwatch",
  "observability",
  "tracing",
  "evaluation",
  "llm",
  "llmops",
  "ai-agents",
  "prompts",
  "analytics",
  "datasets",
] as const;

/** A published skill reduced to what the marketplace needs. */
export interface SkillEntry {
  slug: string;
  isRecipe: boolean;
  description: string;
}

/**
 * Where a skill lives inside the published repo — mirrors sync.ts's writeSkill
 * target exactly (recipes nest under recipes/<slug>). This is also the path we
 * hand Claude Code in the plugin's `skills` array.
 */
export function skillPath(skill: { slug: string; isRecipe: boolean }): string {
  return skill.isRecipe ? `recipes/${skill.slug}` : skill.slug;
}

/**
 * The plugin manifest (.claude-plugin/plugin.json).
 *
 * `skills` is enumerated, not a wildcard: the docs only guarantee a one-level
 * `<name>/SKILL.md` scan, but recipes sit two levels deep (recipes/<slug>).
 * Listing each dir explicitly discovers every skill regardless of depth, and
 * because the plugin's `source` is the marketplace root, an explicit list is
 * required anyway — it replaces the default `skills/` scan (which would find
 * nothing here).
 */
export function buildPluginJson(skills: SkillEntry[], version: string) {
  return {
    name: PLUGIN_NAME,
    displayName: "LangWatch",
    description: PLUGIN_DESCRIPTION,
    version,
    author: { name: "LangWatch", url: "https://langwatch.ai" },
    homepage: HOMEPAGE,
    repository: REPOSITORY,
    license: "MIT",
    keywords: [...KEYWORDS],
    skills: skills.map((s) => `./${skillPath(s)}`),
  };
}

/**
 * The marketplace catalog (.claude-plugin/marketplace.json). A single-plugin
 * marketplace where the plugin IS the repo root (`source: "."`); the plugin's
 * own manifest (plugin.json) carries the skill list and the rest of the
 * metadata.
 */
export function buildMarketplaceJson(skills: SkillEntry[], version: string) {
  return {
    name: MARKETPLACE_NAME,
    owner: { name: "LangWatch", url: "https://langwatch.ai" },
    description: MARKETPLACE_DESCRIPTION,
    plugins: [
      {
        name: PLUGIN_NAME,
        source: ".",
        description: PLUGIN_DESCRIPTION,
        version,
      },
    ],
  };
}

/**
 * The published repo's landing README. The repo has none of its own (sync wipes
 * the target each run), so this is what users see when they land on
 * github.com/langwatch/skills to install.
 */
export function buildReadme(skills: SkillEntry[], version: string): string {
  const features = skills.filter((s) => !s.isRecipe);
  const recipes = skills.filter((s) => s.isRecipe);

  const row = (s: SkillEntry) =>
    `| [\`${s.slug}\`](./${skillPath(s)}/SKILL.md) | ${s.description} |`;

  const section = (rows: SkillEntry[]) =>
    ["| Skill | What it does |", "| --- | --- |", ...rows.map(row)].join("\n");

  return `# LangWatch Skills

Reusable [Agent Skills](https://code.claude.com/docs/en/skills) that give your AI agent LangWatch superpowers — tracing, evaluations, simulations, prompt versioning, analytics, and synthetic datasets. Each skill drives the \`langwatch\` CLI, so it works in Claude Code and any compatible coding agent.

> This file is generated from the canonical sources in [langwatch/langwatch](https://github.com/langwatch/langwatch) (\`skills/\`). Edit there, not here.

## Install

### Claude Code plugin marketplace

\`\`\`bash
/plugin marketplace add langwatch/skills
/plugin install ${PLUGIN_NAME}@${MARKETPLACE_NAME}
\`\`\`

That installs every skill below, each invocable as \`/${PLUGIN_NAME}:<skill>\` (for example \`/${PLUGIN_NAME}:tracing\`). Claude also invokes them automatically when a task matches.

### Any agent (skills CLI)

\`\`\`bash
npx skills add langwatch/skills/<name>
\`\`\`

## Skills

${section(features)}

## Recipes

Focused, task-specific skills.

${section(recipes)}

---

Version \`${version}\` · [Docs](${HOMEPAGE}) · MIT licensed
`;
}
