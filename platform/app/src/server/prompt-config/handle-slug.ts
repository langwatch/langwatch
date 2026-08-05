/**
 * Coerces arbitrary text into a string that satisfies `handleSchema`
 * (lowercase letters, digits, hyphens and underscores).
 *
 * Needed because a prompt is not guaranteed to have a handle: legacy configs
 * predate handles, and their `id` (`prompt_<nanoid>`) contains uppercase,
 * which `handleSchema` rejects. A handle that fails the schema is silently
 * treated as invalid and forces the prompt into draft mode when reopened
 * (see `isHandleValid` in `llmPromptConfigUtils.ts`).
 */
export function toHandleSlug(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "prompt";
}
