/**
 * Skill-invocation detection for coding-agent traces.
 *
 * Claude Code (and compatible harnesses) run a loaded skill through a
 * built-in tool named `Skill` — a `tool_use` block whose input carries the
 * skill's slug. The block-cost classifier already treats this name as a
 * distinct `skill_invocation` category (ADR-033); the trace UI mirrors that
 * so a reader can spot "here I invoked /surf-pr" at a glance instead of it
 * hiding among ordinary Bash/Edit tool calls.
 *
 * Kept as a tiny standalone predicate (no dependency on the block-cost
 * domain, which lives server-side) so both the conversation transcript and
 * the span waterfall can share one definition of "this is a skill".
 */

/** The built-in tool name a harness emits to RUN a skill. */
export const SKILL_TOOL_NAME = "Skill";

/** True when a `tool_use`/span name denotes a skill invocation. */
export function isSkillToolName(name: string | null | undefined): boolean {
  return name === SKILL_TOOL_NAME;
}

/**
 * The invoked skill's slug (e.g. `"surf-pr"`), pulled from a `Skill`
 * tool_use's input. Returns null when the block isn't a skill invocation or
 * the slug is absent/blank, so callers fall back to the bare "Skill" label.
 *
 * Accepts the input as `unknown` — trace payloads are untrusted shape. The
 * harness sends `{ skill: string, args?: string }`; a couple of lenient
 * aliases (`skill_name`, `name`) are honoured for robustness against minor
 * wire drift, none of which change the primary contract.
 */
export function skillSlugFromInput(input: unknown): string | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const obj = input as Record<string, unknown>;
  for (const key of ["skill", "skill_name", "name"]) {
    const value = obj[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

/**
 * Resolve a `tool_use` (by name + input) to a skill invocation, or null when
 * it isn't one. `slug` is the skill name when recoverable from the input.
 */
export function skillInvocationFromToolUse({
  name,
  input,
}: {
  name: string | null | undefined;
  input: unknown;
}): { slug: string | null } | null {
  if (!isSkillToolName(name)) return null;
  return { slug: skillSlugFromInput(input) };
}
