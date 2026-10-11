export function pageTargets({ slug }) {
  if (slug === "introduction") return ["index.html", "introduction/index.html"];
  if (slug.endsWith("/index")) return [`${slug}/index.html`, `${slug}.html`];
  return [`${slug}/index.html`];
}

export function llmsDirectory({ nav }) {
  const lines = Object.entries(nav.pages).map(
    ([slug, page]) =>
      `- [${page.title}](https://docs.langwatch.ai/${slug}.md)${page.description ? `: ${page.description}` : ""}`,
  );
  return `# ${nav.site.name}\n\n## Documentation\n\n${lines.join("\n")}\n`;
}
