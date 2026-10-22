/** One piece of a stylesheet: a style rule, a grouping at-rule, or text kept as it is. */
export type CssNode =
  | { kind: "rule"; selector: string; body: string }
  | { kind: "group"; prelude: string; children: CssNode[] }
  | { kind: "verbatim"; text: string };

/* At-rules whose block holds style rules a page may or may not match; any other at-rule
   (@keyframes, @font-face, @property, statements) is kept whole. */
const GROUPING = /^@(media|supports|layer|container|scope|starting-style)\b/i;

/** Index just past the quoted string, comment or escape at `index`, or `index + 1`. */
function skipToken({ css, index }: { css: string; index: number }) {
  const char = css[index];
  if (char === "\\") return index + 2;
  if (char === "/" && css[index + 1] === "*") {
    const end = css.indexOf("*/", index + 2);
    return end === -1 ? css.length : end + 2;
  }
  if (char === '"' || char === "'") {
    let cursor = index + 1;
    while (cursor < css.length && css[cursor] !== char) cursor += css[cursor] === "\\" ? 2 : 1;
    return cursor + 1;
  }
  return index + 1;
}

/** The first `{`, `;` or `}` at bracket depth zero from `index`, skipping strings and comments. */
function findBoundary({ css, index }: { css: string; index: number }) {
  let depth = 0;
  let cursor = index;
  while (cursor < css.length) {
    const char = css[cursor];
    if (char === "(" || char === "[") depth += 1;
    else if (char === ")" || char === "]") depth -= 1;
    else if (depth <= 0 && (char === "{" || char === ";" || char === "}")) return cursor;
    cursor = skipToken({ css, index: cursor });
  }
  return css.length;
}

/** Index of the `}` closing the block opened at `open`. */
function closingBrace({ css, open }: { css: string; open: number }) {
  let depth = 0;
  let cursor = open;
  while (cursor < css.length) {
    const char = css[cursor];
    if (char === "{") depth += 1;
    else if (char === "}" && --depth === 0) return cursor;
    cursor = skipToken({ css, index: cursor });
  }
  return css.length;
}

/** Splits CSS into rules and groups, keeping every rule's text exactly as written. */
export function parseStylesheet({ css }: { css: string }): CssNode[] {
  const nodes: CssNode[] = [];
  let cursor = 0;
  while (cursor < css.length) {
    while (cursor < css.length && /\s/.test(css[cursor] ?? "")) cursor += 1;
    if (css.startsWith("/*", cursor)) {
      cursor = skipToken({ css, index: cursor });
      continue;
    }
    if (cursor >= css.length) break;
    cursor = readStatement({ css, start: cursor, nodes });
  }
  return nodes;
}

/** Reads the statement or block starting at `start` into `nodes`; returns where it ends. */
function readStatement({ css, start, nodes }: { css: string; start: number; nodes: CssNode[] }) {
  const boundary = findBoundary({ css, index: start });
  const prelude = css.slice(start, boundary).trim();
  if (css[boundary] !== "{") {
    if (prelude) nodes.push({ kind: "verbatim", text: `${prelude};` });
    return boundary + 1;
  }
  const close = closingBrace({ css, open: boundary });
  const body = css.slice(boundary + 1, close);
  if (GROUPING.test(prelude))
    nodes.push({ kind: "group", prelude, children: parseStylesheet({ css: body }) });
  else if (prelude.startsWith("@")) nodes.push({ kind: "verbatim", text: `${prelude}{${body}}` });
  else nodes.push({ kind: "rule", selector: prelude, body });
  return close + 1;
}

export function serializeStylesheet({ nodes }: { nodes: CssNode[] }): string {
  return nodes
    .map((node) => {
      if (node.kind === "verbatim") return node.text;
      if (node.kind === "rule") return `${node.selector}{${node.body}}`;
      return `${node.prelude}{${serializeStylesheet({ nodes: node.children })}}`;
    })
    .join("");
}

/** Keeps the rules `keep` accepts and drops groups left empty. */
export function filterStylesheet({
  nodes,
  keep,
}: {
  nodes: CssNode[];
  keep: (selector: string) => boolean;
}): CssNode[] {
  return nodes.flatMap((node): CssNode[] => {
    if (node.kind === "verbatim") return [node];
    if (node.kind === "rule") return keep(node.selector) ? [node] : [];
    const children = filterStylesheet({ nodes: node.children, keep });
    return children.length > 0 ? [{ ...node, children }] : [];
  });
}

/** `text` split on `separator` outside brackets, strings and comments. */
function splitTopLevel({ text, separator }: { text: string; separator: string }) {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  let cursor = 0;
  while (cursor < text.length) {
    const char = text[cursor];
    if (char === "(" || char === "[") depth += 1;
    else if (char === ")" || char === "]") depth -= 1;
    else if (char === separator && depth === 0) {
      parts.push(text.slice(start, cursor));
      start = cursor + 1;
    }
    cursor = skipToken({ css: text, index: cursor });
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

/** A selector list's complex selectors, split on top-level commas. */
export function splitSelectorList({ selector }: { selector: string }) {
  return splitTopLevel({ text: selector, separator: "," });
}

/** A declaration block's declarations; a block holding nested rules is returned whole. */
export function splitDeclarations({ body }: { body: string }) {
  if (body.includes("{")) return [body];
  return splitTopLevel({ text: body, separator: ";" });
}

/** The same tree with each style rule's body rewritten; rules left empty are dropped. */
export function mapRuleBodies({
  nodes,
  body,
}: {
  nodes: CssNode[];
  body: (node: { selector: string; body: string }) => string;
}): CssNode[] {
  return nodes.flatMap((node): CssNode[] => {
    if (node.kind === "verbatim") return [node];
    if (node.kind === "rule") {
      const rewritten = body(node);
      return rewritten ? [{ ...node, body: rewritten }] : [];
    }
    const children = mapRuleBodies({ nodes: node.children, body });
    return children.length > 0 ? [{ ...node, children }] : [];
  });
}

export function unescapeIdentifier({ name }: { name: string }) {
  return name.replace(/\\(?:([0-9a-fA-F]{1,6})\s?|([\s\S]))/g, (_, hex?: string, char?: string) =>
    hex ? String.fromCodePoint(Number.parseInt(hex, 16)) : (char ?? ""),
  );
}

/* Classes and ids a complex selector cannot match without, as `.name` and `#name`. Names
   inside brackets or pseudo-class arguments (:not, :is, :where, :has) are alternatives or
   negations, so they never make a rule required: leaving them out only keeps more rules. */
export function requiredNames({ selector }: { selector: string }) {
  let outside = "";
  let depth = 0;
  let cursor = 0;
  while (cursor < selector.length) {
    const char = selector[cursor] ?? "";
    const next = skipToken({ css: selector, index: cursor });
    if (char === "(" || char === "[") depth += 1;
    else if (char === ")" || char === "]") depth -= 1;
    else if (depth === 0) outside += selector.slice(cursor, next);
    else outside += " ";
    cursor = next;
  }
  return [
    ...outside.matchAll(/([.#])((?:\\[0-9a-fA-F]{1,6}\s?|\\[\s\S]|[\w-]|[\u0080-\uffff])+)/g),
  ].map((match) => `${match[1]}${unescapeIdentifier({ name: match[2] ?? "" })}`);
}
