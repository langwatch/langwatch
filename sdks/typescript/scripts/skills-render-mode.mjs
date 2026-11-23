/**
 * Which committed render the CLI bundle is built from. `native` (Langy's render)
 * drops the login steps, so only the Langy image, whose bash tool can run the CLI, sets it.
 */
export const RENDER_MODES = ["cli", "native"];

/** Maps LANGWATCH_SKILLS_RENDER to its `_compiled/<mode>` directory name; unset means `cli`. */
export function renderModeDir(value) {
  const mode = value ?? "cli";
  if (!RENDER_MODES.includes(mode)) {
    throw new Error(
      `LANGWATCH_SKILLS_RENDER must be one of ${RENDER_MODES.join(", ")}; got "${value}"`,
    );
  }
  return mode;
}
