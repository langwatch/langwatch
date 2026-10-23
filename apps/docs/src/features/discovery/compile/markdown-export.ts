import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { canonicalUrl, docsUrl } from "../../../lib/site-path.ts";
import { resolveOperation } from "../../api-reference/compile/openapi.ts";
import { generateExample, initialBodyOf } from "../../api-reference/model/codegen.ts";
import type { Content, Operation } from "../../api-reference/model/operation.ts";
import { readFrontmatter, withoutFrontmatter } from "../../content/compile/frontmatter.ts";
import { readDocsConfig } from "../../navigation/compile/nav.ts";
import { withReleaseNotes } from "../../releases/compile/releases.ts";
import { FENCE, mapProse, markedLines, mdxToMarkdown } from "./mdx-markdown.ts";
import { pageDescription } from "./page-head.ts";

const JSON_LINE = 80;

/** JSON indented by level, but any value that fits on one line stays on it. */
function compactJson({ value, indent = "" }: { value: unknown; indent?: string }): string {
  const flat = JSON.stringify(value) ?? "null";
  if (flat.length + indent.length <= JSON_LINE || value === null || typeof value !== "object")
    return flat;
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    const items = value.map((item) => `${inner}${compactJson({ value: item, indent: inner })}`);
    return `[\n${items.join(",\n")}\n${indent}]`;
  }
  const entries = Object.entries(value).map(
    ([key, item]) =>
      `${inner}${JSON.stringify(key)}: ${compactJson({ value: item, indent: inner })}`,
  );
  return `{\n${entries.join(",\n")}\n${indent}}`;
}

function jsonBlock({ value }: { value: unknown }) {
  return `\`\`\`json\n${compactJson({ value })}\n\`\`\``;
}

type SchemaNode = Record<string, unknown>;

const isNode = (value: unknown): value is SchemaNode =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Properties the additionalProperties schema already states, dropped where none is required. */
function restatedDropped({ node }: { node: SchemaNode }): SchemaNode {
  const { properties, additionalProperties: rest } = node;
  if (!isNode(properties) || !isNode(rest)) return node;
  const required = new Set(Array.isArray(node.required) ? node.required : []);
  const shared = JSON.stringify(rest);
  const kept = Object.entries(properties).filter(
    ([name, schema]) => required.has(name) || JSON.stringify(schema) !== shared,
  );
  const { properties: _all, ...others } = node;
  return kept.length ? { ...others, properties: Object.fromEntries(kept) } : others;
}

/** A schema as an agent reads it: the same constraints, each stated once. */
export function readableSchema({ schema }: { schema: unknown }): unknown {
  if (Array.isArray(schema)) return schema.map((item) => readableSchema({ schema: item }));
  if (!isNode(schema)) return schema;
  const node = Object.fromEntries(
    Object.entries(schema).map(([key, value]) => [key, readableSchema({ schema: value })]),
  );
  return restatedDropped({ node });
}

function contentMarkdown({ contents }: { contents: Content[] }) {
  return contents
    .map((content) =>
      [
        `#### ${content.type}`,
        content.schema
          ? `Schema:\n\n${jsonBlock({ value: readableSchema({ schema: content.schema }) })}`
          : "",
        content.example !== void 0 ? `Example:\n\n${jsonBlock({ value: content.example })}` : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
    )
    .join("\n\n");
}

function operationMarkdown({ operation }: { operation: Operation }) {
  const sections = [
    `## Endpoint\n\n\`${operation.method} ${operation.origin}${operation.path}\``,
    operation.deprecated ? "This operation is deprecated." : "",
    "## Authentication",
    operation.schemes.length
      ? operation.schemes
          .map((scheme) =>
            [
              `### ${scheme.id}`,
              scheme.description,
              jsonBlock({ value: { ...scheme, description: void 0 } }),
            ]
              .filter(Boolean)
              .join("\n\n"),
          )
          .join("\n\n")
      : "No security scheme is declared for this operation.",
  ];
  if (operation.parameters.length)
    sections.push(
      "## Parameters",
      ...operation.parameters.map((parameter) =>
        [
          `### ${parameter.name} (${parameter.in}, ${parameter.required ? "required" : "optional"})`,
          parameter.deprecated ? "Deprecated." : "",
          parameter.description,
          jsonBlock({ value: parameter.schema }),
        ]
          .filter(Boolean)
          .join("\n\n"),
      ),
    );
  if (operation.body)
    sections.push(
      `## Request body (${operation.body.required ? "required" : "optional"})`,
      operation.body.description,
      contentMarkdown({ contents: operation.body.contents }),
    );
  sections.push(
    "## Request example",
    "```bash\n" +
      generateExample({
        operation,
        state: { values: {}, body: initialBodyOf({ operation }) },
        language: "curl",
      }) +
      "\n```",
  );
  sections.push(
    "## Responses",
    ...operation.responses.map((response) =>
      [
        `### ${response.status}`,
        response.description,
        contentMarkdown({ contents: response.contents }),
      ]
        .filter(Boolean)
        .join("\n\n"),
    ),
  );
  return sections.filter(Boolean).join("\n\n");
}

const SOURCE_REPOSITORY = "https://github.com/langwatch/langwatch/blob/main/docs";
const SNIPPET_IMPORT = /^import\s+([A-Z]\w*)\s+from\s+["'](\/snippets\/[^"']+\.mdx)["'];?\s*$/;
/** A snippet compiles on its own, so a fence it leaves open ends with it; an empty one goes. */
function closeFence({ source }: { source: string }) {
  const lines = markedLines({ source });
  const opener = lines.findLastIndex((line) => line.opens);
  const closed = lines.slice(opener).some((line) => line.closes);
  if (opener === -1 || closed) return source;
  const empty = lines.slice(opener + 1).every((line) => !line.text.trim());
  if (empty)
    return lines
      .slice(0, opener)
      .map((line) => line.text)
      .join("\n")
      .trimEnd();
  return `${source}\n${FENCE.exec(lines[opener].text)?.[1] ?? "```"}`;
}

/* An imported snippet's content in place of its own-line `<Name />`; an import used any
   other way, or whose file is missing, stays as authored so nothing is lost. */
function inlineSnippets({
  docsRoot,
  source,
  depth = 0,
}: {
  docsRoot: string;
  source: string;
  depth?: number;
}): string {
  const snippets = new Map<string, string>();
  mapProse({
    source,
    line: (text) => {
      const match = SNIPPET_IMPORT.exec(text);
      const file = match ? path.join(docsRoot, match[2]) : "";
      if (match && depth < 3 && existsSync(file)) {
        const body = closeFence({
          source: withoutFrontmatter({ source: readFileSync(file, "utf8") }).trim(),
        });
        snippets.set(match[1], inlineSnippets({ docsRoot, source: body, depth: depth + 1 }));
      }
      return text;
    },
  });
  if (snippets.size === 0) return source;
  const usage = (name: string) => new RegExp(`^\\s*<${name}(\\s[^>]*)?\\s*/>\\s*$`);
  const replaced = mapProse({
    source,
    line: (text) => {
      for (const [name, body] of snippets) if (usage(name).test(text)) return body;
      return text;
    },
  });
  const prose: string[] = [];
  mapProse({
    source: replaced,
    line: (text) => {
      prose.push(text);
      return text;
    },
  });
  const inlined = [...snippets.keys()].filter(
    (name) => !new RegExp(`<${name}\\b`).test(prose.join("\n")),
  );
  return mapProse({
    source: replaced,
    line: (text) => {
      const name = SNIPPET_IMPORT.exec(text)?.[1];
      return name && inlined.includes(name) ? null : text;
    },
  });
}

/** Root-relative links as production URLs, so an export read on its own still resolves. */
function absoluteLinks({ source }: { source: string }) {
  return mapProse({
    source,
    line: (text) =>
      text
        .replace(/\]\(\/(?!\/)/g, `](${docsUrl({ path: "/" })}`)
        .replace(/\bhref="\/(?!\/)/g, `href="${docsUrl({ path: "/" })}`),
  });
}

/** The provenance line that points a lone export at the page directory. */
export const INDEX_LINE = "> Index of all pages: ";

/** Where the page lives, where its source is, and where the full directory starts. */
function provenance({ slug }: { slug: string }) {
  return [
    `> Page: ${canonicalUrl({ slug })}`,
    `> Source: ${SOURCE_REPOSITORY}/${slug}.mdx`,
    `${INDEX_LINE}${docsUrl({ path: "/llms.txt" })}`,
  ].join("\n");
}

/** docs.json `markdown.instructions` as the quoted block Mintlify opens every export with. */
export function agentInstructions({ docsRoot }: { docsRoot: string }) {
  const text = readDocsConfig({ docsRoot }).markdown?.instructions?.trim() ?? "";
  if (!text) return "";
  return ["## Agent Instructions", ...text.split("\n")]
    .map((line) => `> ${line}`.trimEnd())
    .join("\n");
}

/** A page as Markdown: agent instructions, title, description, operation, then the MDX. */
export function pageMarkdown({
  docsRoot,
  slug,
  instructions = agentInstructions({ docsRoot }),
}: {
  docsRoot: string;
  slug: string;
  /** Pass "" where pages are concatenated, so the block appears once rather than per page. */
  instructions?: string;
}) {
  const source = readFileSync(path.join(docsRoot, `${slug}.mdx`), "utf8");
  const metadata = readFrontmatter({ source });
  const operation = metadata.openapi
    ? resolveOperation({ docsRoot, openapi: metadata.openapi })
    : null;
  if (metadata.openapi && !operation)
    throw new Error(`Cannot export unresolved OpenAPI operation for ${slug}`);
  const fallbackTitle = (slug.split("/").pop() ?? slug).replaceAll("-", " ");
  const title = (metadata.title ?? operation?.summary ?? fallbackTitle) || fallbackTitle;
  const description = pageDescription({ title, description: metadata.description, operation });
  const authored = withoutFrontmatter({ source: withReleaseNotes({ source, slug, docsRoot }) });
  const markdown = mdxToMarkdown({ source: inlineSnippets({ docsRoot, source: authored }) });
  const body = absoluteLinks({ source: markdown }).trim();
  return (
    [
      instructions,
      `# ${title}`,
      description,
      provenance({ slug }),
      operation ? operationMarkdown({ operation }) : "",
      body,
    ]
      .filter(Boolean)
      .join("\n\n") + "\n"
  );
}
