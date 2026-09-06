/**
 * Test helper for asserting on Emotion-injected styles.
 *
 * Chakra applies non-token style props (and recipe styles) via an
 * Emotion-injected `<style>` rule keyed on a generated `css-<hash>` class,
 * not an inline `style` attribute — so a visual-style assertion has to read
 * the injected stylesheet rather than the DOM node's `.style`.
 *
 * Reading *every* `<style>` tag, though, makes the assertion non-discriminating:
 * an unrelated component that happens to reference the same variable — or a
 * leftover rule from an earlier test in the same jsdom document — keeps the
 * test green even after the target regresses to a hard-coded value. Scope the
 * assertion to the rendered target's *own* generated classes instead.
 *
 * Returns the concatenated bodies of every injected CSS rule whose selector
 * targets one of `element`'s classes (both the plain `.css-x{…}` block and any
 * `@layer …{.css-x{…}}` block are matched).
 */
export function cssRulesForElement(element: Element): string {
  const classes = Array.from(element.classList);
  if (classes.length === 0) return "";
  const allCss = Array.from(document.querySelectorAll("style"))
    .map((s) => s.innerHTML)
    .join("\n");
  const bodies: string[] = [];
  for (const cls of classes) {
    const escaped = cls.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`\\.${escaped}\\{([^}]*)\\}`, "g");
    let match: RegExpExecArray | null;
    while ((match = re.exec(allCss)) !== null) bodies.push(match[1] ?? "");
  }
  return bodies.join("\n");
}
