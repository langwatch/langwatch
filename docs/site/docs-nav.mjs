import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";

const SPEC_FILES = ["api-reference/openapiLangWatch.json", "api-reference/openapi-evals.json"];
const VERBS = ["get", "post", "put", "patch", "delete"];

const ACRONYMS = new Set(["api", "cli", "id", "ui", "url", "sso", "scim", "llm", "otlp", "ottl", "dspy", "rum", "sql", "pii"]);
const VERB_NAMES = { get: "Get", post: "Create", put: "Update", patch: "Update", delete: "Delete" };
const GROUP_NAMES = { Elevenlabs: "ElevenLabs", Openai: "OpenAI", Langevals: "LangEvals", Ragas: "Ragas" };
const MAX_SUMMARY = 70;
const operationCache = new Map();

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

function operationKey({ openapi }) {
  const match = /^(?:(\w+)\s+)?(\S+)$/.exec(openapi.trim().replace(/^["']|["']$/g, ""));
  if (!match) return "";
  return match[1] ? `${match[1].toUpperCase()} ${match[2]}` : match[2];
}

function operationIndex({ docsRoot }) {
  if (!operationCache.has(docsRoot)) {
    const index = new Map();
    for (const file of SPEC_FILES) {
      const spec = JSON.parse(readFileSync(path.join(docsRoot, file), "utf8"));
      for (const [route, methods] of Object.entries(spec.paths)) {
        for (const verb of VERBS) {
          if (!methods[verb]?.responses) continue;
          const entry = { verb, route, operation: methods[verb] };
          index.set(`${verb.toUpperCase()} ${route}`, entry);
          if (!index.has(route)) index.set(route, entry);
        }
      }
    }
    operationCache.set(docsRoot, index);
  }
  return operationCache.get(docsRoot);
}

/** "getApiTraceId" becomes "Get trace by ID"; the verb word maps to what the call does. */
export function humaniseOperationId({ operationId }) {
  const words = operationId.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(/[\s_-]+/).map((word) => word.toLowerCase()).filter(Boolean);
  const [first, ...rest] = words;
  const subject = rest.filter((word) => word !== "api");
  if (subject.at(-1) === "id" && subject.length > 1 && subject.at(-2) !== "by") subject.splice(-1, 1, "by", "id");
  const text = [VERB_NAMES[first] ?? first, ...subject].map((word) => (ACRONYMS.has(word) ? word.toUpperCase() : word)).join(" ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Authored title first, then the spec summary, then a humanised operationId; never a path. */
function operationTitle({ entry, fallback }) {
  const summary = String(entry?.operation.summary ?? "").trim();
  if (summary && summary.length <= MAX_SUMMARY) return summary;
  if (entry?.operation.operationId) return humaniseOperationId({ operationId: entry.operation.operationId });
  return fallback;
}

function buildItem({ item, docsRoot, pages }) {
  if (typeof item === "string") {
    const file = path.join(docsRoot, `${item}.mdx`);
    if (!existsSync(file)) return null;
    const meta = readFrontmatter({ file });
    const entry = meta.openapi ? operationIndex({ docsRoot }).get(operationKey({ openapi: String(meta.openapi) })) : undefined;
    const derived = meta.openapi ? operationTitle({ entry, fallback: titleCase({ text: item.split("/").pop() }) }) : item;
    pages[item] = {
      title: String(meta.title ?? derived),
      description: meta.description ? String(meta.description) : String(entry?.operation.description ?? "").split("\n")[0],
      sidebarTitle: String(meta.sidebarTitle ?? meta.title ?? derived),
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
  const named = operation.tags?.[0] ?? "";
  const segment = route.split("/").filter((part) => part && part !== "api" && !/^v\d+$/.test(part) && !part.startsWith("{"))[0];
  const name = named || (segment ? titleCase({ text: segment }) : "Other");
  return GROUP_NAMES[name] ?? name;
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
          title: operationTitle({ entry: { operation }, fallback: titleCase({ text: route.split("/").filter((part) => part && !part.startsWith("{")).at(-1) ?? "Operation" }) }),
          route,
          verb,
          description: String(operation.description ?? "").split("\n")[0],
        });
      }
    }
  }
  return out;
}

function slugsOf({ items }) {
  return items.flatMap((item) => (item.type === "page" ? [item.slug] : slugsOf({ items: item.children })));
}

/** Two operations with one title in a group gain their method and path tail. */
function disambiguate({ children, pages }) {
  const counts = new Map();
  for (const child of children) counts.set(child.title, (counts.get(child.title) ?? 0) + 1);
  for (const child of children) {
    if (counts.get(child.title) > 1) {
      const tail = child.route.split("/").filter((part) => part && part !== "api" && !/^v\d+$/.test(part) && !part.startsWith("{")).slice(-2).join("/");
      const title = `${child.title} (${child.verb.toUpperCase()} ${tail})`;
      pages[child.slug].title = title;
      pages[child.slug].sidebarTitle = title;
      child.title = title;
    }
    delete child.route;
    delete child.verb;
  }
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
  const authoredSlugs = new Set(slugsOf({ items: authored }));
  for (const operation of specOperations({ docsRoot })) {
    let slug = bySpec.get(operation.key);
    if (slug && authoredSlugs.has(slug)) continue;
    if (!slug) {
      const base = `api-reference/${kebab({ text: operation.group })}/${kebab({ text: operation.title })}`;
      slug = base;
      for (let n = 2; taken.has(slug); n += 1) slug = `${base}-${n}`;
      taken.add(slug);
      pages[slug] = { title: operation.title, description: operation.description, sidebarTitle: operation.title, openapi: operation.openapi, mode: "", icon: "", generated: true };
    }
    if (!groups.has(operation.group)) groups.set(operation.group, []);
    groups.get(operation.group).push({ type: "page", slug, title: pages[slug].sidebarTitle, route: operation.route, verb: operation.verb });
  }
  for (const children of groups.values()) disambiguate({ children, pages });
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
