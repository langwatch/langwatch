import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { canonicalUrl, docsUrl } from "../../../lib/site-path.ts";
import { resolveOperation } from "../../api-reference/compile/openapi.ts";
import { generateExample, initialBodyOf } from "../../api-reference/model/codegen.ts";
import type { Content, Operation } from "../../api-reference/model/operation.ts";
import { readFrontmatter, withoutFrontmatter } from "../../content/compile/frontmatter.ts";
import { withReleaseNotes } from "../../releases/compile/releases.ts";

function jsonBlock({ value }: { value: unknown }) {
  return `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
}

function contentMarkdown({ contents }: { contents: Content[] }) {
  return contents
    .map((content) =>
      [
        `#### ${content.type}`,
        content.schema ? `Schema:\n\n${jsonBlock({ value: content.schema })}` : "",
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
            [`### ${scheme.id}`, scheme.description, jsonBlock({ value: scheme })]
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
const FENCE = /^\s*(`{3,}|~{3,})/;
const CLOSING_FENCE = /^\s*(`{3,}|~{3,})\s*$/;

/** Rewrites (or with null drops) each line outside fenced code; code is never touched. */
function mapProse({ source, line }: { source: string; line: (text: string) => string | null }) {
  let fence: string | null = null;
  return source
    .split("\n")
    .flatMap((text) => {
      if (fence) {
        const marker = CLOSING_FENCE.exec(text)?.[1];
        if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = null;
        return [text];
      }
      fence = FENCE.exec(text)?.[1] ?? null;
      if (fence) return [text];
      const mapped = line(text);
      return mapped === null ? [] : [mapped];
    })
    .join("\n");
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
        const body = withoutFrontmatter({ source: readFileSync(file, "utf8") }).trim();
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

/** Where the page lives, where its source is, and where the full directory starts. */
function provenance({ slug }: { slug: string }) {
  return [
    `> Page: ${canonicalUrl({ slug })}`,
    `> Source: ${SOURCE_REPOSITORY}/${slug}.mdx`,
    `> Index of all pages: ${docsUrl({ path: "/llms.txt" })}`,
  ].join("\n");
}

/** A page as Markdown: title, description, the resolved operation, then the authored MDX. */
export function pageMarkdown({ docsRoot, slug }: { docsRoot: string; slug: string }) {
  const source = readFileSync(path.join(docsRoot, `${slug}.mdx`), "utf8");
  const metadata = readFrontmatter({ source });
  const operation = metadata.openapi
    ? resolveOperation({ docsRoot, openapi: metadata.openapi })
    : null;
  if (metadata.openapi && !operation)
    throw new Error(`Cannot export unresolved OpenAPI operation for ${slug}`);
  const fallbackTitle = (slug.split("/").pop() ?? slug).replaceAll("-", " ");
  const title = (metadata.title ?? operation?.summary ?? fallbackTitle) || fallbackTitle;
  const description = metadata.description ?? operation?.description ?? "";
  const authored = withoutFrontmatter({ source: withReleaseNotes({ source, slug, docsRoot }) });
  const body = absoluteLinks({ source: inlineSnippets({ docsRoot, source: authored }) }).trim();
  return (
    [
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
