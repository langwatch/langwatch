import { segments } from "./mdx-text.ts";

// MDX source as a tree of components: a hand-rolled scanner, since only tags matter.

export type Attributes = Record<string, string | true>;
export type Element = {
  kind: "element";
  name: string;
  attributes: Attributes;
  children: MdxNode[];
};
export type MdxNode = { kind: "text" | "code"; text: string } | (Element & { open: string });
export type Token =
  | { kind: "text" | "code"; text: string }
  | { kind: "open"; name: string; attributes: Attributes; raw: string; selfClosing: boolean }
  | { kind: "close"; name: string; raw: string };

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
function tagAt({
  text,
  at,
  known,
}: {
  text: string;
  at: number;
  known: ReadonlySet<string>;
}): { token: Token; end: number } | null {
  const head = /^<(\/?)([A-Za-z][\w.]*)/.exec(text.slice(at, at + 64));
  const [, closing, name] = head ?? [];
  if (!head || name === undefined || !known.has(name)) return null;
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
function specialAt({ text, at, known }: { text: string; at: number; known: ReadonlySet<string> }) {
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
    const tag = tagAt({ text, at, known });
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
function scanText({
  text,
  tokens,
  known,
}: {
  text: string;
  tokens: Token[];
  known: ReadonlySet<string>;
}) {
  const pushText = (value: string) => {
    const last = tokens.at(-1);
    if (last?.kind === "text") last.text += value;
    else if (value) tokens.push({ kind: "text", text: value });
  };
  const pattern = /[`<{]/g;
  let from = 0;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    const found = specialAt({ text, at: match.index, known });
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

/** The source as a tree of the `known` components; any other or unmatched tag stays text. */
export function parseMdx({
  source,
  known,
}: {
  source: string;
  known: ReadonlySet<string>;
}): MdxNode[] {
  const tokens: Token[] = [];
  for (const part of segments({ source }))
    if (part.kind === "code") tokens.push(part);
    else scanText({ text: part.text, tokens, known });
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
