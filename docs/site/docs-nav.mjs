import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";

const SPEC_FILES = ["api-reference/openapiLangWatch.json", "api-reference/openapi-evals.json"];
const VERBS = ["get", "post", "put", "patch", "delete"];

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
      mode: meta.mode ? String(meta.mode) : "",
      icon: meta.icon ? String(meta.icon) : "",
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

function kebab({ text }) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 56).replace(/-$/, "");
}

function titleCase({ text }) {
  return text.replace(/[-_]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function groupNameOf({ operation, route }) {
  if (operation.tags?.[0]) return operation.tags[0];
  const segment = route.split("/").filter((part) => part && part !== "api" && !/^v\d+$/.test(part) && !part.startsWith("{"))[0];
  return segment ? titleCase({ text: segment }) : "Other";
}

/** Every operation in both specs, in spec order, with its group name. */
function specOperations({ docsRoot }) {
  const out = [];
  for (const file of SPEC_FILES) {
    const spec = JSON.parse(readFileSync(path.join(docsRoot, file), "utf8"));
    for (const [route, methods] of Object.entries(spec.paths)) {
      for (const verb of VERBS) {
        const operation = methods[verb];
        if (!operation?.responses) continue;
        out.push({
          key: `${verb.toUpperCase()} ${route}`,
          openapi: `${verb.toUpperCase()} ${route}`,
          group: groupNameOf({ operation, route }),
          title: String(operation.summary ?? operation.operationId ?? route),
          description: String(operation.description ?? "").split("\n")[0],
        });
      }
    }
  }
  return out;
}

/** The API Reference anchor: authored non-endpoint groups, then one group per OpenAPI tag. */
function apiAnchor({ anchor, docsRoot, pages }) {
  const authored = anchor.children.filter((child) => child.type === "group" && !child.children.some((page) => page.type === "page" && pages[page.slug]?.openapi));
  const bySpec = new Map();
  for (const [slug, meta] of Object.entries(pages)) {
    if (meta.openapi) bySpec.set(meta.openapi.replace(/^"|"$/g, "").trim().replace(/^(\w+)/, (verb) => verb.toUpperCase()), slug);
  }
  const groups = new Map();
  const taken = new Set(Object.keys(pages));
  for (const operation of specOperations({ docsRoot })) {
    let slug = bySpec.get(operation.key);
    if (!slug) {
      const base = `api-reference/${kebab({ text: operation.group })}/${kebab({ text: operation.title })}`;
      slug = base;
      for (let n = 2; taken.has(slug); n += 1) slug = `${base}-${n}`;
      taken.add(slug);
      pages[slug] = { title: operation.title, description: operation.description, sidebarTitle: operation.title, openapi: operation.openapi, mode: "", icon: "", generated: true };
    }
    if (!groups.has(operation.group)) groups.set(operation.group, []);
    groups.get(operation.group).push({ type: "page", slug, title: pages[slug].sidebarTitle });
  }
  const tagGroups = [...groups].map(([title, children]) => ({ type: "group", title, children }));
  return { ...anchor, children: [...authored, ...tagGroups] };
}

export function buildNav({ docsRoot }) {
  const config = JSON.parse(readFileSync(path.join(docsRoot, "docs.json"), "utf8"));
  const pages = {};
  const anchors = (config.navigation?.anchors ?? []).map((anchor) => {
    const children = [...(anchor.groups ?? []), ...(anchor.pages ?? [])]
      .map((item) => buildItem({ item, docsRoot, pages }))
      .filter(Boolean);
    return { title: String(anchor.anchor), icon: String(anchor.icon ?? ""), children };
  });
  const support = (config.navigation?.global?.anchors ?? []).map((anchor) => ({
    title: String(anchor.anchor),
    icon: String(anchor.icon ?? ""),
    href: String(anchor.href ?? ""),
  }));
  const apiIndex = anchors.findIndex((anchor) => anchor.title === "API Reference");
  if (apiIndex >= 0) anchors[apiIndex] = apiAnchor({ anchor: anchors[apiIndex], docsRoot, pages });
  const banner = config.banner?.content ? { content: String(config.banner.content), dismissible: config.banner.dismissible !== false } : null;
  const links = config.navbar?.links ?? [];
  const site = {
    name: String(config.name ?? "LangWatch"),
    banner,
    searchPrompt: String(config.search?.prompt ?? "Search the LangWatch docs"),
    signIn: String(links.find((link) => /sign ?in/i.test(link.label))?.href ?? "https://app.langwatch.ai"),
    github: String(config.navbar?.primary?.href ?? "https://github.com/langwatch/langwatch"),
    llms: String(links.find((link) => /llms/i.test(link.label))?.href ?? "https://docs.langwatch.ai/llms.txt"),
    stars: null,
    notFound: { title: String(config.errors?.["404"]?.title ?? "Page not found"), description: String(config.errors?.["404"]?.description ?? "") },
  };
  return { anchors, support, pages, site };
}

export function openapiPages({ docsRoot }) {
  const { pages } = buildNav({ docsRoot });
  return Object.fromEntries(Object.entries(pages).filter(([, meta]) => meta.openapi).map(([slug, meta]) => [slug, meta.openapi]));
}

const STARS_URL = "https://api.github.com/repos/langwatch/langwatch";

/** The public star count at build time; the last known value is kept when GitHub cannot be reached. */
let starsRead;
function readStars({ docsRoot }) {
  starsRead ??= fetchStars({ docsRoot });
  return starsRead;
}

async function fetchStars({ docsRoot }) {
  const cacheDir = path.join(docsRoot, "site/node_modules/.cache/docs-site");
  const cacheFile = path.join(cacheDir, "stars.json");
  try {
    const response = await fetch(STARS_URL, { signal: AbortSignal.timeout(4000), headers: { accept: "application/vnd.github+json" } });
    const count = (await response.json()).stargazers_count;
    if (response.ok && Number.isInteger(count)) {
      mkdirSync(cacheDir, { recursive: true });
      writeFileSync(cacheFile, JSON.stringify({ count }));
      return count;
    }
  } catch {}
  try {
    return JSON.parse(readFileSync(cacheFile, "utf8")).count ?? null;
  } catch {
    return null;
  }
}

export function docsNavPlugin({ docsRoot }) {
  return {
    name: "docs-nav",
    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : null;
    },
    async load(id) {
      if (id !== RESOLVED_ID) return null;
      this.addWatchFile(path.join(docsRoot, "docs.json"));
      const nav = buildNav({ docsRoot });
      nav.site.stars = await readStars({ docsRoot });
      return `export default ${JSON.stringify(nav)};`;
    },
  };
}
