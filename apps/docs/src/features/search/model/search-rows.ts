import { pagePath } from "../../../lib/site-path.ts";
import { searchIndex, type SearchIndex } from "./search-engine.ts";

export const QUICK_ACTION_GROUP = "Quick actions";

export const QUICK_ACTIONS = [
  {
    id: "app",
    title: "Open app",
    href: "https://app.langwatch.ai",
    description: "Go to your LangWatch workspace",
  },
  {
    id: "github",
    title: "GitHub",
    href: "https://github.com/langwatch/langwatch",
    description: "Explore the source and contribute",
  },
  { id: "theme", title: "Toggle theme", href: "", description: "Switch between light and dark" },
  { id: "copy", title: "Copy page", href: "", description: "Copy this page as Markdown for LLMs" },
];

export type SearchRow = {
  id: string;
  title: string;
  description: string;
  href: string;
  group: string;
  method: string;
  heading: boolean;
  icon: string;
  glyph: string;
};

/** The command bar's rows for a query: quick actions first, then matching pages and headings. */
export function searchRows({
  index,
  query,
}: {
  index: SearchIndex | null;
  query: string;
}): SearchRow[] {
  const results = index ? searchIndex({ index, query }) : [];
  const pages = results.map(({ entry, heading }) => ({
    id: `${entry.slug}#${heading?.id ?? ""}`,
    title: entry.title,
    description: heading ? `↳ ${heading.text}` : entry.description,
    href: `${pagePath({ slug: entry.slug })}${heading ? `#${heading.id}` : ""}`,
    group: entry.section,
    method: entry.method,
    heading: Boolean(heading),
    icon: entry.icon,
    glyph: index?.glyphs.get(entry.icon) ?? "",
  }));
  const actions = QUICK_ACTIONS.filter(
    (action) =>
      !query || `${action.title} ${action.description}`.toLowerCase().includes(query.toLowerCase()),
  ).map((action) => ({
    ...action,
    group: QUICK_ACTION_GROUP,
    method: "",
    heading: false,
    icon: "",
    glyph: "",
  }));
  return [...pages, ...actions].toSorted((left, right) => {
    const leftGroup = left.group === QUICK_ACTION_GROUP ? "" : left.group;
    const rightGroup = right.group === QUICK_ACTION_GROUP ? "" : right.group;
    return leftGroup.localeCompare(rightGroup);
  });
}
