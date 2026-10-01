export function cssRulesForElement(element: Element): string {
  const classes = Array.from(element.classList);
  if (classes.length === 0) return "";
  const allCss = Array.from(document.querySelectorAll("style"))
    .map((style) => style.innerHTML)
    .join("\n");
  return classes
    .map((className) => {
      const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const match = new RegExp(`\\.${escaped}\\{([^}]*)\\}`, "g").exec(allCss);
      return match?.[1] ?? "";
    })
    .join("\n");
}
