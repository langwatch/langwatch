/** Logos drawn in their own colours, which read on either paper without a chip. */
const COLOUR_LOGOS = new Set(["golang", "gemini", "codex"]);

/** Whether an icon is a logo path drawn in its own colours; dark marks need a light chip. */
export function isColourLogo({ icon }: { icon: string }) {
  return COLOUR_LOGOS.has(
    icon
      .split("/")
      .at(-1)
      ?.replace(/\.\w+$/, "") ?? "",
  );
}
