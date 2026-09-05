/**
 * Skill-invocation detection for coding-agent traces.
 */

/** The built-in tool name a harness emits to RUN a skill. */
export const SKILL_TOOL_NAME = "Skill";

/** True when a `tool_use`/span name denotes a skill invocation. */
export function isSkillToolName(name: string | null | undefined): boolean {
  return name === SKILL_TOOL_NAME;
}

/**
 * True when a span is a skill run — a `tool`-type span named `Skill`. Drives
 * the waterfall's skill glyph + accent (TreeRow / GroupRow). The type guard
 * keeps a user-named non-tool span called "Skill" from being mis-flagged.
 */
export function isSkillSpan({
  type,
  name,
}: {
  type: string | null | undefined;
  name: string | null | undefined;
}): boolean {
  return type === "tool" && isSkillToolName(name);
}

/**
 * The invoked skill's slug (e.g. `"surf-pr"`), pulled from a `Skill` tool_use's input.
 * Returns null when the block isn't a skill invocation or the slug is absent/blank, so
 * callers fall back to the bare "Skill" label.
 */
export function skillSlugFromInput(input: unknown): string | null {
  if (!isRecord(input)) return null;

  const obj = input;
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
import { isRecord } from "./record";
