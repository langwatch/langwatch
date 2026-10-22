import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

import { docsUrl } from "../../../lib/site-path.ts";
import { operationIndex, parseOpenapiRef } from "../../api-reference/compile/openapi.ts";
import { readFrontmatter } from "../../content/compile/frontmatter.ts";
import { readReleases } from "../../releases/compile/releases.ts";
import type { Nav, NavItem, PageMeta } from "../model/nav.ts";

const ACRONYMS = new Set([
  "api",
  "cli",
  "id",
  "ui",
  "url",
  "sso",
  "scim",
  "llm",
  "otlp",
  "ottl",
  "dspy",
  "rum",
  "sql",
  "pii",
]);
const VERB_NAMES: Record<string, string> = {
  get: "Get",
  post: "Create",
  put: "Update",
  patch: "Update",
  delete: "Delete",
};
const MAX_SUMMARY = 70;
const CARD = /<Card\b([^>]*?)\/?>/g;
const LOGO_DIRECTORY = "/images/logos/";

export type DocsItem =
  | string
  | { group?: string; pages?: DocsItem[]; root?: string; expanded?: boolean; icon?: string }
  | null;
const docsItem: z.ZodType<DocsItem> = z.union([
  z.string(),
  z.looseObject({
    group: z.string().optional(),
    root: z.string().optional(),
    expanded: z.boolean().optional(),
    icon: z.string().optional(),
    get pages() {
      return z.array(docsItem).optional();
    },
  }),
  z.unknown().transform(() => null),
]);
const docsConfigSchema = z.looseObject({
  name: z.string().optional(),
  navigation: z
    .looseObject({
      anchors: z
        .array(
          z.looseObject({
            anchor: z.string(),
            icon: z.string().optional(),
            groups: z.array(docsItem).optional(),
            pages: z.array(docsItem).optional(),
          }),
        )
        .optional(),
      global: z
        .looseObject({
          anchors: z
            .array(
              z.looseObject({
                anchor: z.string(),
                icon: z.string().optional(),
                href: z.string().optional(),
              }),
            )
            .optional(),
        })
        .optional(),
    })
    .optional(),
  navbar: z
    .looseObject({
      links: z.array(z.looseObject({ label: z.string(), href: z.string() })).optional(),
      primary: z.looseObject({ href: z.string().optional() }).optional(),
    })
    .optional(),
  search: z.looseObject({ prompt: z.string().optional() }).optional(),
  errors: z
    .looseObject({
      "404": z
        .looseObject({ title: z.string().optional(), description: z.string().optional() })
        .optional(),
    })
    .optional(),
  redirects: z.array(z.looseObject({ source: z.string(), destination: z.string() })).optional(),
});
/** docs.json, the authored site map: navigation, navbar, errors and redirects. */
export function readDocsConfig({ docsRoot }: { docsRoot: string }) {
  return docsConfigSchema.parse(JSON.parse(readFileSync(path.join(docsRoot, "docs.json"), "utf8")));
}

function operationKey({ openapi }: { openapi: string }) {
  const ref = parseOpenapiRef({ openapi });
  if (!ref) return "";
  return ref.method ? `${ref.method.toUpperCase()} ${ref.route}` : ref.route;
}

/** "getApiTraceId" becomes "Get trace by ID"; the verb word maps to what the call does. */
export function humaniseOperationId({ operationId }: { operationId: string }) {
  const words = operationId
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s_-]+/)
    .map((word) => word.toLowerCase())
    .filter(Boolean);
  const [first, ...rest] = words;
  const subject = rest.filter((word) => word !== "api");
  if (subject.at(-1) === "id" && subject.length > 1 && subject.at(-2) !== "by")
    subject.splice(-1, 1, "by", "id");
  const text = [VERB_NAMES[first] ?? first, ...subject]
    .map((word) => (ACRONYMS.has(word) ? word.toUpperCase() : word))
    .join(" ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function titleCase({ text }: { text: string }) {
  return text.replace(/[-_]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

/** Authored title first, then the spec summary, then a humanised operationId; never a path. */
function operationTitle({
  operation,
  fallback,
}: {
  operation?: { summary?: string; operationId?: string };
  fallback: string;
}) {
  const summary = (operation?.summary ?? "").trim();
  if (summary && summary.length <= MAX_SUMMARY) return summary;
  if (operation?.operationId) return humaniseOperationId({ operationId: operation.operationId });
  return fallback;
}

function buildPage({
  item,
  docsRoot,
  pages,
  logos,
}: {
  item: string;
  docsRoot: string;
  pages: Record<string, PageMeta>;
  logos: Map<string, string>;
}): NavItem {
  const file = path.join(docsRoot, `${item}.mdx`);
  if (!existsSync(file)) {
    throw Object.assign(new Error(`Configured documentation page is missing: ${item}`), {
      code: "docs_page_missing",
    });
  }
  const source = readFileSync(file, "utf8");
  const meta = readFrontmatter({ source });
  collectLogos({ source, logos });
  const operation = meta.openapi
    ? operationIndex({ docsRoot }).get(operationKey({ openapi: meta.openapi }))
    : undefined;
  const derived = meta.openapi
    ? operationTitle({ operation, fallback: titleCase({ text: item.split("/").pop() ?? item }) })
    : item;
  pages[item] = {
    title: meta.title ?? derived,
    description: meta.description || (operation?.description ?? "").split("\n")[0],
    sidebarTitle: meta.sidebarTitle ?? meta.title ?? derived,
    openapi: meta.openapi ?? "",
    mode: meta.mode ?? "",
    icon: meta.icon ?? "",
    logo: "",
  };
  return { type: "page", slug: item, title: pages[item].sidebarTitle };
}

/** Overview cards pair a page link with its brand logo; the first card for a page wins. */
function collectLogos({ source, logos }: { source: string; logos: Map<string, string> }) {
  for (const [, attributes] of source.matchAll(CARD)) {
    const icon = /\bicon="([^"]+)"/.exec(attributes)?.[1] ?? "";
    const slug = /\bhref="\/([^"#?]+)/.exec(attributes)?.[1];
    if (slug && icon.startsWith(LOGO_DIRECTORY) && !logos.has(slug)) logos.set(slug, icon);
  }
}

function buildItem({
  item,
  docsRoot,
  pages,
  logos,
}: {
  item: DocsItem;
  docsRoot: string;
  pages: Record<string, PageMeta>;
  logos: Map<string, string>;
}): NavItem | null {
  if (typeof item === "string") return buildPage({ item, docsRoot, pages, logos });
  if (item?.group) {
    const children = (item.pages ?? [])
      .map((child) => buildItem({ item: child, docsRoot, pages, logos }))
      .filter((child) => child !== null);
    return {
      type: "group",
      title: item.group,
      children,
      ...(item.root ? { root: item.root } : {}),
      ...(item.expanded ? { expanded: true } : {}),
      ...(item.icon ? { icon: item.icon } : {}),
    };
  }
  return null;
}

/** A heading's id as rehype-slug (github-slugger) writes it. */
const headingId = ({ text }: { text: string }) =>
  text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");

/**
 * Where a group header links. docs.json (Mintlify) takes only a page as a group's
 * root, so a root page with a heading named like the group links to that heading.
 */
function rootHref({ docsRoot, root, title }: { docsRoot: string; root: string; title: string }) {
  if (root.includes("#")) return root;
  const source = readFileSync(path.join(docsRoot, `${root}.mdx`), "utf8");
  const wanted = headingId({ text: title });
  const found = [...source.matchAll(/^#{2,6}\s+(.+)$/gm)].some(
    ([, text]) => headingId({ text }) === wanted,
  );
  return found ? `${root}#${wanted}` : root;
}

function sharedLogo({ items, pages }: { items: NavItem[]; pages: Record<string, PageMeta> }) {
  const logos = new Set<string>();
  for (const item of items) {
    if (item.type !== "page") continue;
    const logo = pages[item.slug].logo;
    if (logo) logos.add(logo);
  }
  return logos.size === 1 ? [...logos][0] : "";
}

/** Checks group roots; a group without an icon takes the one logo its own pages share. */
function finishGroups({
  items,
  pages,
  docsRoot,
}: {
  items: NavItem[];
  pages: Record<string, PageMeta>;
  docsRoot: string;
}): NavItem[] {
  return items.map((item) => {
    if (item.type === "page") return item;
    const rootSlug = item.root?.split("#")[0];
    if (rootSlug !== undefined && !pages[rootSlug]) {
      throw Object.assign(new Error(`Group "${item.title}" has an unlisted root: ${item.root}`), {
        code: "docs_group_root_missing",
      });
    }
    const root = item.root ? rootHref({ docsRoot, root: item.root, title: item.title }) : undefined;
    const children = finishGroups({ items: item.children, pages, docsRoot });
    const icon = item.icon || sharedLogo({ items: children, pages });
    return { ...item, children, ...(root ? { root } : {}), ...(icon ? { icon } : {}) };
  });
}

/** docs.json as navigation, page inventory and site metadata; only listed pages publish. */
export function buildNav({ docsRoot }: { docsRoot: string }): Nav {
  const config = readDocsConfig({ docsRoot });
  const pages: Record<string, PageMeta> = {};
  const logos = new Map<string, string>();
  const built = (config.navigation?.anchors ?? []).map((anchor) => {
    const children = [...(anchor.groups ?? []), ...(anchor.pages ?? [])]
      .map((item) => buildItem({ item, docsRoot, pages, logos }))
      .filter((child) => child !== null);
    return { title: anchor.anchor, icon: anchor.icon ?? "", children };
  });
  for (const [slug, meta] of Object.entries(pages)) meta.logo = logos.get(slug) ?? "";
  const anchors = built.map((anchor) => ({
    ...anchor,
    children: finishGroups({ items: anchor.children, pages, docsRoot }),
  }));
  const support = (config.navigation?.global?.anchors ?? []).map((anchor) => ({
    title: anchor.anchor,
    icon: anchor.icon ?? "",
    href: anchor.href ?? "",
  }));
  const links = config.navbar?.links ?? [];
  const site = {
    name: config.name ?? "LangWatch",
    releases: readReleases({ docsRoot }),
    searchPrompt: config.search?.prompt ?? "Search the LangWatch docs",
    signIn: links.find((link) => /sign ?in/i.test(link.label))?.href ?? "https://app.langwatch.ai",
    github: config.navbar?.primary?.href ?? "https://github.com/langwatch/langwatch",
    llms: links.find((link) => /llms/i.test(link.label))?.href ?? docsUrl({ path: "/llms.txt" }),
    stars: null,
    notFound: {
      title: config.errors?.["404"]?.title ?? "Page not found",
      description: config.errors?.["404"]?.description ?? "",
    },
  };
  return { anchors, support, pages, site };
}

/** Slug to `openapi:` reference for every configured API page. */
export function openapiPages({ docsRoot }: { docsRoot: string }) {
  return Object.fromEntries(
    Object.entries(buildNav({ docsRoot }).pages)
      .filter(([, meta]) => meta.openapi)
      .map(([slug, meta]) => [slug, meta.openapi]),
  );
}
