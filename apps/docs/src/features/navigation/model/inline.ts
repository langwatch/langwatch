/** One-line Markdown as docs.json authors it (banner, 404 copy): emphasis, code and links. */
export type Inline =
  | { type: "text"; value: string }
  | { type: "code"; value: string }
  | { type: "strong"; children: Inline[] }
  | { type: "link"; href: string; children: Inline[] };

const DOCS_ORIGINS = ["https://langwatch.ai/docs", "https://docs.langwatch.ai"];

/** A link to this site as a root-relative path, so it follows the build's base path. */
export function localHref({ href }: { href: string }) {
  for (const origin of DOCS_ORIGINS) {
    if (href === origin) return "/";
    if (href.startsWith(`${origin}/`)) return href.slice(origin.length);
  }
  return href;
}

/* Finds the `]` closing a link label, skipping nested brackets. */
function closingBracket({ source, from }: { source: string; from: number }) {
  let depth = 0;
  for (let index = from; index < source.length; index += 1) {
    if (source[index] === "[") depth += 1;
    if (source[index] === "]") {
      if (depth === 0) return index;
      depth -= 1;
    }
  }
  return -1;
}

/** Parses `**strong**`, `` `code` `` and `[label](href)`; anything else stays text. */
export function parseInline({ source }: { source: string }): Inline[] {
  const nodes: Inline[] = [];
  let text = "";
  const flush = () => {
    if (text) nodes.push({ type: "text", value: text });
    text = "";
  };
  let index = 0;
  while (index < source.length) {
    const rest = source.slice(index);
    const strongEnd = rest.startsWith("**") ? rest.indexOf("**", 2) : -1;
    if (strongEnd > 2) {
      flush();
      nodes.push({ type: "strong", children: parseInline({ source: rest.slice(2, strongEnd) }) });
      index += strongEnd + 2;
      continue;
    }
    const codeEnd = rest.startsWith("`") ? rest.indexOf("`", 1) : -1;
    if (codeEnd > 1) {
      flush();
      nodes.push({ type: "code", value: rest.slice(1, codeEnd) });
      index += codeEnd + 1;
      continue;
    }
    if (rest.startsWith("[")) {
      const close = closingBracket({ source, from: index + 1 });
      const target = close > 0 ? /^\(([^)\s]+)\)/.exec(source.slice(close + 1)) : null;
      if (target) {
        flush();
        nodes.push({
          type: "link",
          href: localHref({ href: target[1] }),
          children: parseInline({ source: source.slice(index + 1, close) }),
        });
        index = close + 1 + target[0].length;
        continue;
      }
    }
    text += source[index];
    index += 1;
  }
  flush();
  return nodes;
}

/** The text a reader sees, for labels and metadata. */
export function inlineText({ nodes }: { nodes: Inline[] }): string {
  return nodes
    .map((node) => ("children" in node ? inlineText({ nodes: node.children }) : node.value))
    .join("");
}
