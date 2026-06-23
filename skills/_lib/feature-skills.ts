// The published LangWatch skill set — exactly the skills shown on the public
// directory (https://langwatch.ai/docs/skills/directory) and synced to the
// langwatch/skills repo. Single source of truth for "our skills", shared by the
// publisher (skills/_publish/sync.ts) and the langy-agent native generator
// (skills/_compiler/native.ts) so the in-product assistant loads EXACTLY what we
// publish — same set, same content. Recipes under skills/recipes/ are
// intentionally NOT here: they are internal and not part of the published set.
export const FEATURE_SKILLS = [
  "tracing",
  "evaluations",
  "scenarios",
  "prompts",
  "analytics",
  "level-up",
  "datasets",
] as const;
