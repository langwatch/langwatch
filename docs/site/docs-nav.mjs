import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";

const VIRTUAL_ID = "virtual:docs-nav";
const RESOLVED_ID = `\0${VIRTUAL_ID}`;

function readFrontmatter({ file }) {
  const text = readFileSync(file, "utf8");
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) return {};
  try {
    return parse(match[1]) ?? {};
  } catch {
    return {};
  }
}

function buildItem({ item, docsRoot, pages }) {
  if (typeof item === "string") {
    const file = path.join(docsRoot, `${item}.mdx`);
    if (!existsSync(file)) return null;
    const meta = readFrontmatter({ file });
    pages[item] = {
      title: String(meta.title ?? item),
      description: meta.description ? String(meta.description) : "",
      sidebarTitle: String(meta.sidebarTitle ?? meta.title ?? item),
      openapi: meta.openapi ? String(meta.openapi) : "",
    };
    return { type: "page", slug: item, title: pages[item].sidebarTitle };
  }
  if (item && typeof item === "object" && item.group) {
    const children = (item.pages ?? [])
      .map((child) => buildItem({ item: child, docsRoot, pages }))
      .filter(Boolean);
    return { type: "group", title: String(item.group), children };
  }
  return null;
}

export function buildNav({ docsRoot }) {
  const config = JSON.parse(readFileSync(path.join(docsRoot, "docs.json"), "utf8"));
  const pages = {};
  const anchors = (config.navigation?.anchors ?? []).map((anchor) => {
    const children = [...(anchor.groups ?? []), ...(anchor.pages ?? [])]
      .map((item) => buildItem({ item, docsRoot, pages }))
      .filter(Boolean);
    return { title: String(anchor.anchor), children };
  });
  return { anchors, pages };
}

export function docsNavPlugin({ docsRoot }) {
  return {
    name: "docs-nav",
    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : null;
    },
    load(id) {
      if (id !== RESOLVED_ID) return null;
      this.addWatchFile(path.join(docsRoot, "docs.json"));
      return `export default ${JSON.stringify(buildNav({ docsRoot }))};`;
    },
  };
}
