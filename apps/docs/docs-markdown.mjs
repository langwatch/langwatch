import { readFileSync } from "node:fs";
import path from "node:path";

import { parse } from "yaml";

import { resolveOperation } from "./docs-openapi.mjs";
import { withReleaseNotes } from "./docs-releases.mjs";
import { generateExample, initialBodyOf } from "./src/api/codegen.ts";

function jsonBlock({ value }) {
  return `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
}

function contentMarkdown({ contents }) {
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

function operationMarkdown({ operation }) {
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

export function pageMarkdown({ docsRoot, slug }) {
  const source = readFileSync(path.join(docsRoot, `${slug}.mdx`), "utf8");
  const frontmatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  const metadata = frontmatter ? (parse(frontmatter[1]) ?? {}) : {};
  const operation = metadata.openapi
    ? resolveOperation({ docsRoot, openapi: String(metadata.openapi) })
    : null;
  if (metadata.openapi && !operation)
    throw new Error(`Cannot export unresolved OpenAPI operation for ${slug}`);
  const fallbackTitle = slug.split("/").pop().replaceAll("-", " ");
  const title = String(metadata.title ?? operation?.summary ?? fallbackTitle) || fallbackTitle;
  const description = String(metadata.description ?? operation?.description ?? "");
  const body = withReleaseNotes({ source, slug, docsRoot })
    .replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "")
    .trim();
  return (
    [`# ${title}`, description, operation ? operationMarkdown({ operation }) : "", body]
      .filter(Boolean)
      .join("\n\n") + "\n"
  );
}
