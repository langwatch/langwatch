/**
 * A prompt has no folder column. Its "folder" is a prefix on its handle:
 * `onboarding/welcome` lives in the `onboarding` folder and is named `welcome`.
 *
 * Single Responsibility: Split a prompt handle into the parts the UI shows.
 */

export const NEW_PROMPT_TITLE = "New Prompt";

/**
 * The prompt's own name, without the folder it lives in.
 *
 * `onboarding/welcome` -> `welcome`. Deeper handles take the last segment, so
 * `a/b/c` -> `c`: the name is always what comes after the final separator.
 */
export function getDisplayHandle(handle?: string | null): string {
  if (!handle) return NEW_PROMPT_TITLE;
  const name = handle.split("/").at(-1);
  return name ? name : handle;
}

/**
 * The folder a prompt lives in, or undefined when it lives at the top level.
 *
 * `onboarding/welcome` -> `onboarding`. Matches how the sidebar groups prompts
 * into sections, which keys off the first segment.
 */
export function getPromptFolder(handle?: string | null): string | undefined {
  if (!handle?.includes("/")) return undefined;
  const folder = handle.split("/")[0];
  return folder ? folder : undefined;
}
