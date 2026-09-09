/**
 * Test helper for asserting on Emotion-injected styles.
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
    let match = re.exec(allCss);
    while (match !== null) {
      bodies.push(match[1] ?? "");
      match = re.exec(allCss);
    }
  }
  return bodies.join("\n");
}
