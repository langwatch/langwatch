import { docsUrl } from "../../../lib/site-path.ts";
import { parseFenceMeta } from "../../code/compile/rehype-code.ts";
import { languageName } from "../../code/ui/languages.ts";
import { promptFileName } from "../../content/compile/skill-prompts.ts";

export const FENCE = /^\s*(`{3,}|~{3,})/;
const CLOSING_FENCE = /^\s*(`{3,}|~{3,})\s*$/;

/** Rewrites (or with null drops) each line outside fenced code; code is never touched. */
export function mapProse({
  source,
  line,
}: {
  source: string;
  line: (text: string) => string | null;
}) {
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

type Attributes = Record<string, string | true>;
type Element = { kind: "element"; name: string; attributes: Attributes; children: MdxNode[] };
type MdxNode = { kind: "text" | "code"; text: string } | (Element & { open: string });
type Token =
  | { kind: "text" | "code"; text: string }
  | { kind: "open"; name: string; attributes: Attributes; raw: string; selfClosing: boolean }
  | { kind: "close"; name: string; raw: string };
/** `level` is the heading level of the section a component sits in; the page title is 1. */
type Context = { level: number };
type Converter = (args: { element: Element; context: Context }) => string;

type MarkedLine = { text: string; code: boolean; opens: boolean; closes: boolean };

/** Each line of a source, marked when it opens, sits in or closes fenced code. */
export function markedLines({ source }: { source: string }): MarkedLine[] {
  let fence: string | null = null;
  return source.split("\n").map((text) => {
    if (fence) {
      const marker = CLOSING_FENCE.exec(text)?.[1];
      const closes = Boolean(marker && marker[0] === fence[0] && marker.length >= fence.length);
      if (closes) fence = null;
      return { text, code: true, opens: false, closes };
    }
    fence = FENCE.exec(text)?.[1] ?? null;
    return { text, code: fence !== null, opens: fence !== null, closes: false };
  });
}

/** MDX comments, which may span lines and hold fences; one opening inside code is kept. */
function dropComments({ source }: { source: string }) {
  const output: string[] = [];
  let open = false;
  for (const line of markedLines({ source })) {
    if (!open && (line.code || !line.text.includes("{/*"))) {
      output.push(line.text);
      continue;
    }
    const result = withoutComments({ text: line.text, open });
    open = result.open;
    if (result.kept.trim() || !line.text.trim()) output.push(result.kept);
  }
  return output.join("\n");
}

/** One line less its comment text; `open` says whether a comment runs into or past it. */
function withoutComments({ text, open }: { text: string; open: boolean }) {
  let rest = text;
  let kept = "";
  let inside = open;
  for (let marker = rest.indexOf(inside ? "*/}" : "{/*"); marker !== -1;) {
    if (!inside) kept += rest.slice(0, marker);
    rest = rest.slice(marker + 3);
    inside = !inside;
    marker = rest.indexOf(inside ? "*/}" : "{/*");
  }
  return { kept: inside ? kept : kept + rest, open: inside };
}

/** Prose and fenced code in order; each fenced block is its own part, kept byte for byte. */
function segments({ source }: { source: string }) {
  const parts: { kind: "text" | "code"; text: string }[] = [];
  for (const line of markedLines({ source })) {
    const kind = line.code ? "code" : "text";
    const last = parts.at(-1);
    if (last?.kind === kind && !line.opens) last.text += `\n${line.text}`;
    else {
      if (last) last.text += "\n";
      parts.push({ kind, text: line.text });
    }
  }
  return parts;
}

const MDX_STATEMENT =
  /^\s*(import\s[^;]*\bfrom\s+["'][^"']+["'];?|import\s+["'][^"']+["'];?|export\s+(const|let|function|default)\b.*)\s*$/;

/** MDX `import` and `export` lines carry nothing a reader of the Markdown can use. */
function dropStatements({ source }: { source: string }) {
  return mapProse({ source, line: (text) => (MDX_STATEMENT.test(text) ? null : text) });
}

/** A JSX attribute value from `="…"`, `='…'` or a balanced `={…}` expression. */
function attributeValue({ text, at }: { text: string; at: number }) {
  const quote = text[at];
  if (quote === '"' || quote === "'") {
    const end = text.indexOf(quote, at + 1);
    return end === -1 ? null : { value: text.slice(at + 1, end), end: end + 1 };
  }
  if (quote !== "{") return null;
  const end = expressionEnd({ text, at });
  if (end === -1) return null;
  return { value: expressionValue({ source: text.slice(at + 1, end) }), end: end + 1 };
}

const QUOTES = new Set(['"', "'", "`"]);
const BRACE_DEPTH: Record<string, number> = { "{": 1, "}": -1 };

/** Where the `{…}` expression opening at `at` closes, string braces ignored; -1 if never. */
function expressionEnd({ text, at }: { text: string; at: number }) {
  let depth = 0;
  let string: string | null = null;
  for (let index = at; index < text.length; index += 1) {
    const char = text[index] ?? "";
    if (string) string = char === string && text[index - 1] !== "\\" ? null : string;
    else if (QUOTES.has(char)) string = char;
    else depth += BRACE_DEPTH[char] ?? 0;
    if (depth === 0) return index;
  }
  return -1;
}

/** A string literal's text; any other expression as written. */
function expressionValue({ source }: { source: string }) {
  const trimmed = source.trim();
  if (!/^(["'`])[\s\S]*\1$/.test(trimmed)) return trimmed;
  try {
    return trimmed.startsWith('"') ? String(JSON.parse(trimmed)) : trimmed.slice(1, -1);
  } catch {
    return trimmed.slice(1, -1);
  }
}

/** A converted component's tag at `at`, or null when it is anything else. */
function tagAt({ text, at }: { text: string; at: number }): { token: Token; end: number } | null {
  const head = /^<(\/?)([A-Za-z][\w.]*)/.exec(text.slice(at, at + 64));
  const [, closing, name] = head ?? [];
  if (!head || name === undefined || !Object.hasOwn(CONVERTERS, name)) return null;
  const attributes: Attributes = {};
  for (let index = at + head[0].length; index < text.length;) {
    index += /^\s*/.exec(text.slice(index))?.[0].length ?? 0;
    const close = tagCloseAt({ text, index });
    if (close) {
      const raw = text.slice(at, close.end);
      if (closing) return { token: { kind: "close", name, raw }, end: close.end };
      const token = { kind: "open" as const, name, attributes, raw, selfClosing: close.self };
      return { token, end: close.end };
    }
    const next = readAttribute({ text, index, attributes });
    if (next === null) return null;
    index = next;
  }
  return null;
}

/** The end of a tag closing at `index` with `>` or `/>`, or null when it does not close there. */
function tagCloseAt({ text, index }: { text: string; index: number }) {
  if (text.startsWith("/>", index)) return { end: index + 2, self: true };
  return text[index] === ">" ? { end: index + 1, self: false } : null;
}

/** Reads one attribute at `index` into `attributes`; where it ends, or null when malformed. */
function readAttribute({
  text,
  index,
  attributes,
}: {
  text: string;
  index: number;
  attributes: Attributes;
}) {
  const attribute = /^[\w:.-]+/.exec(text.slice(index, index + 64))?.[0];
  if (!attribute) return null;
  const after = index + attribute.length;
  if (text[after] !== "=") {
    attributes[attribute] = true;
    return after;
  }
  const value = attributeValue({ text, at: after + 1 });
  if (!value) return null;
  attributes[attribute] = value.value;
  return value.end;
}

/** What starts at a special character: a code span (kept), a comment (dropped) or a tag. */
function specialAt({ text, at }: { text: string; at: number }) {
  if (text.startsWith("{/*", at)) {
    const end = text.indexOf("*/}", at);
    return end === -1 ? null : { end: end + 3, token: null, drop: true };
  }
  const literal = /^\{\s*(["'])([^"'\n]*)\1\s*\}/.exec(text.slice(at, at + 200));
  if (literal)
    return {
      end: at + literal[0].length,
      token: { kind: "text" as const, text: literal[2] ?? "" },
      drop: false,
    };
  if (text[at] === "<") {
    const tag = tagAt({ text, at });
    return tag ? { ...tag, drop: false } : null;
  }
  if (text[at] !== "`") return null;
  const run = /^`+/.exec(text.slice(at))?.[0] ?? "`";
  const end = text.indexOf(run, at + run.length);
  const paragraph = text.slice(at, end).search(/\n\s*\n/);
  return end === -1 || paragraph !== -1
    ? null
    : { end: end + run.length, token: null, drop: false };
}

/** A prose part as text and component tags, inline code spans left whole. */
function scanText({ text, tokens }: { text: string; tokens: Token[] }) {
  const pushText = (value: string) => {
    const last = tokens.at(-1);
    if (last?.kind === "text") last.text += value;
    else if (value) tokens.push({ kind: "text", text: value });
  };
  const pattern = /[`<{]/g;
  let from = 0;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    const found = specialAt({ text, at: match.index });
    if (!found) continue;
    if (found.token || found.drop) {
      pushText(text.slice(from, match.index));
      if (found.token) tokens.push(found.token);
      from = found.end;
    }
    pattern.lastIndex = found.end;
  }
  pushText(text.slice(from));
}

/** An element left open is put back as its authored tag followed by its content. */
function unwrap({ parent, element }: { parent: Element; element: Element & { open: string } }) {
  const index = parent.children.indexOf(element);
  parent.children.splice(index, 1, { kind: "text", text: element.open }, ...element.children);
}

type OpenElement = Element & { open: string };

function top({ stack }: { stack: OpenElement[] }) {
  const element = stack.at(-1);
  if (element === undefined) throw new Error("The element stack is empty");
  return element;
}

/** Adds an element for an opening tag; one that is not self-closing takes what follows. */
function openTag({
  stack,
  token,
}: {
  stack: OpenElement[];
  token: Extract<Token, { kind: "open" }>;
}) {
  const { name, attributes, raw } = token;
  const element = {
    kind: "element" as const,
    name,
    attributes,
    open: raw,
    children: [] as MdxNode[],
  };
  top({ stack }).children.push(element);
  if (!token.selfClosing) stack.push(element);
}

/** Closes the nearest open element of the tag's name; a stray closing tag stays text. */
function closeTag({
  stack,
  token,
}: {
  stack: OpenElement[];
  token: Extract<Token, { kind: "close" }>;
}) {
  if (!stack.some((element, index) => index > 0 && element.name === token.name)) {
    top({ stack }).children.push({ kind: "text", text: token.raw });
    return;
  }
  for (let open = stack.pop(); open && open.name !== token.name; open = stack.pop())
    unwrap({ parent: top({ stack }), element: open });
}

/** The source as a tree of converted components; unmatched tags stay text. */
function parseMdx({ source }: { source: string }): MdxNode[] {
  const tokens: Token[] = [];
  for (const part of segments({ source }))
    if (part.kind === "code") tokens.push(part);
    else scanText({ text: part.text, tokens });
  const root = { kind: "element" as const, name: "", attributes: {}, children: [], open: "" };
  const stack: OpenElement[] = [root];
  for (const token of tokens) {
    if (token.kind === "open") openTag({ stack, token });
    else if (token.kind === "close") closeTag({ stack, token });
    else top({ stack }).children.push(token);
  }
  while (stack.length > 1) {
    const open = stack.pop();
    if (open) unwrap({ parent: top({ stack }), element: open });
  }
  return root.children;
}

/** Lines less their shared leading whitespace, as MDX reads content nested in a component. */
function dedent({ text }: { text: string }) {
  const lines = text.split("\n");
  const indents = lines
    .filter((line) => line.trim())
    .map((line) => /^\s*/.exec(line)?.[0].length ?? 0);
  const shared = indents.length ? Math.min(...indents) : 0;
  return lines.map((line) => (line.trim() ? line.slice(shared) : "")).join("\n");
}

/** Removes repeated blank lines and whitespace-only lines outside code. */
function squeeze({ source }: { source: string }) {
  const lines: string[] = [];
  for (const line of markedLines({ source })) {
    const blank = !line.code && line.text.trim() === "";
    if (blank && (lines.length === 0 || lines[lines.length - 1] === "")) continue;
    lines.push(blank ? "" : line.text);
  }
  return lines.join("\n");
}

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

function heading({ context, title }: { context: Context; title: string }) {
  return `${"#".repeat(Math.min(context.level + 1, 6))} ${title}`;
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

/** A skill as its title, its two commands and a link to its prompt's own Markdown file. */
function skillMarkdown({
  title,
  install,
  command,
  prompt,
  context,
}: {
  title: string;
  install: string;
  command: string;
  prompt: string;
  context: Context;
}) {
  const lines = [
    install ? `- Install via CLI: \`${install}\`` : "",
    command ? `- Skill command: \`${command}\`` : "",
    prompt ? `- Full prompt: ${docsUrl({ path: `/${promptFileName({ prompt })}` })}` : "",
  ];
  return [heading({ context, title }), lines.filter(Boolean).join("\n")].join("\n\n");
}

const SKILL_CARD = /^(\s*)<div className="lw-accordion">\s*$/;

/** Generated `lw-accordion` skill markup, read as the remark adapter reads it. */
function skillFromMarkup({ lines, context }: { lines: MarkedLine[]; context: Context }) {
  const markup = lines
    .filter((line) => !line.code)
    .map((line) => line.text)
    .join("\n");
  const title = /lw-accordion-title"[^>]*>([^<]*)</.exec(markup)?.[1] ?? "Skill";
  const commands = [...markup.matchAll(/<code>([\s\S]*?)<\/code>/g)].map((match) =>
    (match[1] ?? "").replace(/<[^>]+>/g, "").trim(),
  );
  const code = lines.filter((line) => line.code);
  const close = code.findIndex((line) => line.closes);
  const prompt = code
    .slice(1, close === -1 ? void 0 : close)
    .map((line) => line.text)
    .join("\n");
  return skillMarkdown({
    title,
    install: commands[0] ?? "",
    command: commands[1] ?? "",
    prompt,
    context,
  });
}

/** A skill card opening on this line, or null. */
function cardOpening({ line }: { line: MarkedLine }) {
  const opening = line.code ? null : SKILL_CARD.exec(line.text);
  return opening ? { indent: opening[1] ?? "", lines: [] as MarkedLine[] } : null;
}

/** The section level after a line: a prose heading's, else the one before. */
function proseLevel({ line, level }: { line: MarkedLine; level: number }) {
  if (line.code) return level;
  return /^(#{1,6})\s/.exec(line.text)?.[1]?.length ?? level;
}

/** Swaps each generated skill card for its commands and prompt link; nothing else changes. */
function skillCards({ source }: { source: string }) {
  if (!source.includes("lw-accordion")) return source;
  const output: string[] = [];
  let card: { indent: string; lines: MarkedLine[] } | null = null;
  let level = 1;
  for (const line of markedLines({ source })) {
    card ??= cardOpening({ line });
    if (!card) {
      level = proseLevel({ line, level });
      output.push(line.text);
      continue;
    }
    card.lines.push(line);
    if (line.code || line.text !== `${card.indent}</div>`) continue;
    output.push(skillFromMarkup({ lines: card.lines, context: { level } }));
    card = null;
  }
  if (card) output.push(...card.lines.map((line) => line.text));
  return output.join("\n");
}

/* One converter per component the MDX renderer registers, plus the HTML media authors use.
   A converter returns plain Markdown; content nested in a component is converted first. */
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

/** Authored MDX as plain Markdown: components converted, statements and comments dropped. */
export function mdxToMarkdown({ source }: { source: string }) {
  const prepared = skillCards({ source: dropStatements({ source: dropComments({ source }) }) });
  return squeeze({
    source: renderNodes({ nodes: parseMdx({ source: prepared }), context: { level: 1 } }),
  });
}
