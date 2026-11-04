import { parseFenceMeta } from "../../code/compile.ts";
import { languageName } from "../../code/model.ts";
import { parseMdx, type Element, type MdxNode } from "./mdx-parse.ts";
import { skillMarkdown, skillCards } from "./mdx-skills.ts";
import {
  dedent,
  dropComments,
  dropStatements,
  heading,
  squeeze,
  type Context,
} from "./mdx-text.ts";

type Converter = (args: { element: Element; context: Context }) => string;

const INLINE = new Set(["Icon", "Tooltip", "a", "img", "span", "DocsImg", "DocsInlineCode"]);
const FIELDS = new Set(["ParamField", "ResponseField"]);

function isElement(node: MdxNode | undefined): node is Element & { open: string } {
  return node?.kind === "element";
}

/** Puts a converted block where its tag was, indented as the tag was, on its own lines. */
function place({ output, block, inline }: { output: string; block: string; inline: boolean }) {
  if (inline) return output + block;
  const prefix = output.slice(output.lastIndexOf("\n") + 1);
  const indent = prefix.trim() ? "" : prefix;
  const indented = block
    .split("\n")
    .map((line) => (line ? indent + line : line))
    .join("\n");
  return `${output.slice(0, output.length - indent.length)}\n\n${indented}\n\n`;
}

/** Consecutive fields from `from`, whitespace between them included, and where the run ends. */
function fieldRun({ nodes, from }: { nodes: MdxNode[]; from: number }) {
  const fields: Element[] = [];
  let next = from;
  for (let index = from; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (node === undefined) continue;
    if (isElement(node) && FIELDS.has(node.name)) {
      fields.push(node);
      next = index + 1;
    } else if (isElement(node) || node.text.trim()) break;
  }
  return { fields, next };
}

/** Nodes as Markdown; `context.level` follows the section headings the prose opens. */
function renderNodes({ nodes, context }: { nodes: MdxNode[]; context: Context }): string {
  let output = "";
  let level = context.level;
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (node === undefined) continue;
    if (!isElement(node)) {
      output += node.text;
      const headings = node.kind === "text" ? [...node.text.matchAll(/^ {0,3}(#{1,6})\s/gm)] : [];
      level = headings.at(-1)?.[1]?.length ?? level;
      continue;
    }
    if (FIELDS.has(node.name)) {
      const run = fieldRun({ nodes, from: index });
      output = place({
        output,
        block: fieldsMarkdown({ fields: run.fields, context: { level } }),
        inline: false,
      });
      index = run.next - 1;
      continue;
    }
    const block = convert({ element: node, context: { level } });
    output = place({ output, block, inline: INLINE.has(node.name) });
  }
  return output;
}

function convert({ element, context }: { element: Element; context: Context }) {
  const converter = CONVERTERS[element.name];
  if (!converter) throw new Error(`No converter for <${element.name}>`);
  return converter({ element, context });
}

/** An element's content as standalone Markdown. */
function inner({ element, context }: { element: Element; context: Context }) {
  return squeeze({
    source: dedent({ text: renderNodes({ nodes: element.children, context }) }),
  }).trim();
}

function text({ element, name }: { element: Element; name: string }) {
  const value = element.attributes[name];
  return typeof value === "string" ? value : "";
}

function flagged({ element, name }: { element: Element; name: string }) {
  const value = element.attributes[name];
  return value === true || value === "true";
}

/** Each element child converted; non-blank text kept; `render` may claim an element child. */
function childBlocks({
  element,
  context,
  render,
}: {
  element: Element;
  context: Context;
  render?: (child: Element, index: number) => string | null;
}) {
  let index = -1;
  return element.children.flatMap((child) => {
    if (!isElement(child)) return child.text.trim() ? [dedent({ text: child.text }).trim()] : [];
    index += 1;
    const claimed = render?.(child, index);
    return [claimed ?? convert({ element: child, context })].filter(Boolean);
  });
}

const BLOCK_START = /^(\s*([-*+]|\d+\.)\s|#|\||>|`{3}|~{3}|!\[)/;

function callout({ label }: { label: string }): Converter {
  return ({ element, context }) => {
    const body = inner({ element, context });
    if (!body) return `> **${label}**`;
    const opened = `**${label}:**${BLOCK_START.test(body) ? "\n\n" : " "}${body}`;
    if (/^\s*(`{3}|~{3})/m.test(body)) return opened;
    return opened
      .split("\n")
      .map((line) => (line ? `> ${line}` : ">"))
      .join("\n");
  };
}

/** A titled section one level below the one it sits in; its content nests under it. */
function section({
  element,
  context,
  title,
}: {
  element: Element;
  context: Context;
  title: string;
}) {
  const nested = { level: Math.min(context.level + 1, 6) };
  const description = text({ element, name: "description" });
  return [heading({ context, title }), description, inner({ element, context: nested })]
    .filter(Boolean)
    .join("\n\n");
}

function labelled({ label, body }: { label: string; body: string }) {
  return [`**${label}**`, body].filter(Boolean).join("\n\n");
}

/** A code block's tab label: its fence title, else its language's name. */
function codeLabel({ code }: { code: string }) {
  const info = /^\s*(?:`{3,}|~{3,})\s*(\S*)\s*(.*)$/.exec(code.split("\n")[0] ?? "");
  const title = parseFenceMeta({ meta: info?.[2] ?? "" }).title;
  return title || languageName({ lang: info?.[1] ?? "" });
}

function card({ element, context }: { element: Element; context: Context }) {
  const title = text({ element, name: "title" });
  const href = text({ element, name: "href" });
  const name = href ? `[${title || href}](${href})` : title && `**${title}**`;
  const body = [text({ element, name: "description" }), inner({ element, context })]
    .filter(Boolean)
    .join("\n\n");
  const simple = !/\n\s*\n/.test(body) && !body.split("\n").some((line) => BLOCK_START.test(line));
  if (simple) return `- ${[name, body.split("\n").join(" ")].filter(Boolean).join(": ")}`;
  const nested = body.split("\n").map((line) => (line ? `  ${line}` : line));
  return [`- ${name || "Card"}`, nested.join("\n")].join("\n\n");
}

function fieldName({ element }: { element: Element }) {
  return (
    ["name", "path", "query", "body", "header"]
      .map((name) => text({ element, name }))
      .find(Boolean) ?? ""
  );
}

function fieldLocation({ element }: { element: Element }) {
  if (element.name !== "ParamField") return "";
  const location = text({ element, name: "location" });
  return (
    location || (["path", "query", "header", "body"].find((name) => text({ element, name })) ?? "")
  );
}

function cell({ value }: { value: string }) {
  const lines = value.split("\n").map((line) => line.trim());
  return lines
    .filter(Boolean)
    .join(" ")
    .replace(/(?<!\\)\|/g, "\\|");
}

/** A field and its expandable children as table rows, or null when it cannot fit a table. */
function fieldRows({
  element,
  context,
  prefix,
}: {
  element: Element;
  context: Context;
  prefix: string;
}): string[] | null {
  const expandable = (node: MdxNode) => isElement(node) && node.name === "Expandable";
  const own = { ...element, children: element.children.filter((child) => !expandable(child)) };
  const description = inner({ element: own, context });
  if (/^\s*(`{3}|~{3})/m.test(description)) return null;
  const name = `${prefix}${fieldName({ element })}`;
  const location = fieldLocation({ element });
  const type = text({ element, name: "type" });
  const fallback = text({ element, name: "default" });
  const notes = [
    flagged({ element, name: "deprecated" }) ? "Deprecated." : "",
    description,
    fallback ? `Default: \`${fallback}\`.` : "",
  ];
  const row = [
    `\`${name}\`${location ? ` (${location})` : ""}`,
    type ? `\`${type}\`` : "",
    flagged({ element, name: "required" }) ? "yes" : "no",
    notes.filter(Boolean).join(" "),
  ];
  const nested = childFieldRows({ element, context, name });
  if (!nested) return null;
  return [`| ${row.map((value) => cell({ value })).join(" | ")} |`, ...nested];
}

/** The rows of a field's expandable child fields, named under it; null when one cannot fit. */
function childFieldRows({
  element,
  context,
  name,
}: {
  element: Element;
  context: Context;
  name: string;
}) {
  const rows: string[] = [];
  const children = element.children
    .filter((node) => isElement(node) && node.name === "Expandable")
    .flatMap((node) => (isElement(node) ? node.children : []));
  for (const child of children) {
    if (!isElement(child) || !FIELDS.has(child.name)) continue;
    const nested = fieldRows({ element: child, context, prefix: `${name}.` });
    if (!nested) return null;
    rows.push(...nested);
  }
  return rows;
}

/** A field that holds code, written as its name and facts, then its content. */
function fieldBlock({ element, context }: { element: Element; context: Context }) {
  const facts = [
    text({ element, name: "type" }),
    fieldLocation({ element }),
    flagged({ element, name: "required" }) ? "required" : "",
    flagged({ element, name: "deprecated" }) ? "deprecated" : "",
  ].filter(Boolean);
  const title = `**\`${fieldName({ element })}\`**${facts.length ? ` (${facts.join(", ")})` : ""}`;
  return [title, inner({ element, context })].filter(Boolean).join("\n\n");
}

const FIELD_HEADER = "| Name | Type | Required | Description |\n| --- | --- | --- | --- |";

/** Consecutive fields as one table of name, type, required and description. */
function fieldsMarkdown({ fields, context }: { fields: Element[]; context: Context }) {
  const blocks: string[] = [];
  let rows: string[] = [];
  const flush = () => {
    if (rows.length) blocks.push(`${FIELD_HEADER}\n${rows.join("\n")}`);
    rows = [];
  };
  for (const element of fields) {
    const fieldTable = fieldRows({ element, context, prefix: "" });
    if (fieldTable) rows.push(...fieldTable);
    else {
      flush();
      blocks.push(fieldBlock({ element, context }));
    }
  }
  flush();
  return blocks.join("\n\n");
}

/** A media element's source: its own `src`, else its first `<source>` child's. */
function mediaSource({ element }: { element: Element }) {
  const child = element.children.find((node) => isElement(node) && node.name.endsWith("ource"));
  return (
    text({ element, name: "src" }) ||
    (isElement(child) ? text({ element: child, name: "src" }) : "")
  );
}

function image({ element }: { element: Element }) {
  const src = text({ element, name: "src" });
  return src ? `![${text({ element, name: "alt" })}](${src})` : "";
}

function mediaLink({ fallback }: { fallback: string }): Converter {
  return ({ element }) => {
    const src = mediaSource({ element });
    return src ? `[${text({ element, name: "title" }) || fallback}](${src})` : "";
  };
}

const CONVERTERS: Record<string, Converter> = {
  Tip: callout({ label: "Tip" }),
  Note: callout({ label: "Note" }),
  Info: callout({ label: "Info" }),
  Warning: callout({ label: "Warning" }),
  Check: callout({ label: "Check" }),
  Tabs: ({ element, context }) => childBlocks({ element, context }).join("\n\n"),
  Tab: ({ element, context }) =>
    labelled({
      label: text({ element, name: "title" }) || "Tab",
      body: inner({ element, context }),
    }),
  CodeGroup: ({ element, context }) =>
    element.children
      .flatMap((child) => {
        if (child.kind === "code") {
          const code = dedent({ text: child.text }).trimEnd();
          return [labelled({ label: codeLabel({ code }), body: code })];
        }
        if (isElement(child)) return [convert({ element: child, context })];
        return child.text.trim() ? [dedent({ text: child.text }).trim()] : [];
      })
      .filter(Boolean)
      .join("\n\n"),
  CodeGroupItem: ({ element, context }) =>
    labelled({
      label: text({ element, name: "title" }) || "Example",
      body: inner({ element, context }),
    }),
  Steps: ({ element, context }) =>
    childBlocks({
      element,
      context,
      render: (child, index) =>
        child.name === "Step"
          ? section({
              element: child,
              context,
              title: `${index + 1}. ${text({ element: child, name: "title" }) || `Step ${index + 1}`}`,
            })
          : null,
    }).join("\n\n"),
  Step: ({ element, context }) =>
    section({ element, context, title: text({ element, name: "title" }) || "Step" }),
  CardGroup: ({ element, context }) => {
    const cards = childBlocks({ element, context });
    return cards.join(cards.every((block) => !block.includes("\n")) ? "\n" : "\n\n");
  },
  Card: card,
  AgentQuickStart: ({ element, context }) => inner({ element, context }),
  AccordionGroup: ({ element, context }) => childBlocks({ element, context }).join("\n\n"),
  Accordion: ({ element, context }) =>
    section({ element, context, title: text({ element, name: "title" }) || "Details" }),
  Expandable: ({ element, context }) =>
    labelled({
      label: text({ element, name: "title" }) || "Child fields",
      body: inner({ element, context }),
    }),
  ParamField: ({ element, context }) => fieldsMarkdown({ fields: [element], context }),
  ResponseField: ({ element, context }) => fieldsMarkdown({ fields: [element], context }),
  Frame: ({ element, context }) => {
    const caption = text({ element, name: "caption" });
    return [inner({ element, context }), caption ? `*${caption}*` : ""]
      .filter(Boolean)
      .join("\n\n");
  },
  img: image,
  DocsImg: image,
  video: mediaLink({ fallback: "Video" }),
  DocsVideo: mediaLink({ fallback: "Video" }),
  iframe: mediaLink({ fallback: "Embedded content" }),
  DocsIframe: mediaLink({ fallback: "Embedded content" }),
  source: () => "",
  div: ({ element, context }) => inner({ element, context }),
  span: ({ element, context }) => inner({ element, context }),
  DocsSource: () => "",
  a: ({ element, context }) => {
    const href = text({ element, name: "href" });
    const body = inner({ element, context });
    return href ? `[${body || href}](${href})` : body;
  },
  Icon: () => "",
  Tooltip: ({ element, context }) => inner({ element, context }),
  LegacyContent: ({ element, context }) => inner({ element, context }),
  AgentActions: () =>
    "[Launch your agent](#getting-started) · [Follow the quickstart](/coding-agents/quickstart)",
  SkillCard: ({ element, context }) =>
    skillMarkdown({
      title: text({ element, name: "title" }) || "Skill",
      install: text({ element, name: "install" }),
      command: text({ element, name: "command" }),
      prompt: text({ element, name: "prompt" }),
      context,
    }),
  DocsAnchor: ({ element, context }) => inner({ element, context }),
  DocsInlineCode: ({ element, context }) => `\`${inner({ element, context })}\``,
  DocsTable: ({ element, context }) => inner({ element, context }),
  DocsTableCell: ({ element, context }) => inner({ element, context }),
};

/** The component names with a Markdown converter, for checking against the renderer. */
export const MARKDOWN_COMPONENTS = Object.keys(CONVERTERS);
const KNOWN_COMPONENTS: ReadonlySet<string> = new Set(MARKDOWN_COMPONENTS);

/** Authored MDX as plain Markdown: components converted, statements and comments dropped. */
export function mdxToMarkdown({ source }: { source: string }) {
  const prepared = skillCards({ source: dropStatements({ source: dropComments({ source }) }) });
  return squeeze({
    source: renderNodes({
      nodes: parseMdx({ source: prepared, known: KNOWN_COMPONENTS }),
      context: { level: 1 },
    }),
  });
}
