import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

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

export type DocsItem = string | { group?: string; pages?: DocsItem[] } | null;
const docsItem: z.ZodType<DocsItem> = z.union([
  z.string(),
  z.looseObject({
    group: z.string().optional(),
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
}: {
  item: string;
  docsRoot: string;
  pages: Record<string, PageMeta>;
}): NavItem {
  const file = path.join(docsRoot, `${item}.mdx`);
  if (!existsSync(file)) {
    throw Object.assign(new Error(`Configured documentation page is missing: ${item}`), {
      code: "docs_page_missing",
    });
  }
  const meta = readFrontmatter({ source: readFileSync(file, "utf8") });
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
  };
  return { type: "page", slug: item, title: pages[item].sidebarTitle };
}

function buildItem({
  item,
  docsRoot,
  pages,
}: {
  item: DocsItem;
  docsRoot: string;
  pages: Record<string, PageMeta>;
}): NavItem | null {
  if (typeof item === "string") return buildPage({ item, docsRoot, pages });
  if (item?.group) {
    const children = (item.pages ?? [])
      .map((child) => buildItem({ item: child, docsRoot, pages }))
      .filter((child) => child !== null);
    return { type: "group", title: item.group, children };
  }
  return null;
}

/** docs.json as navigation, page inventory and site metadata; only listed pages publish. */
export function buildNav({ docsRoot }: { docsRoot: string }): Nav {
  const config = readDocsConfig({ docsRoot });
  const pages: Record<string, PageMeta> = {};
  const anchors = (config.navigation?.anchors ?? []).map((anchor) => {
    const children = [...(anchor.groups ?? []), ...(anchor.pages ?? [])]
      .map((item) => buildItem({ item, docsRoot, pages }))
      .filter((child) => child !== null);
    return { title: anchor.anchor, icon: anchor.icon ?? "", children };
  });
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
    llms:
      links.find((link) => /llms/i.test(link.label))?.href ?? "https://docs.langwatch.ai/llms.txt",
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
