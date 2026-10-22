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

type Scan = { nodes: Inline[]; text: string; index: number };

function flushText({ scan }: { scan: Scan }) {
  if (scan.text) scan.nodes.push({ type: "text", value: scan.text });
  scan.text = "";
}

function scanStrong({ scan, rest }: { scan: Scan; rest: string }) {
  const end = rest.startsWith("**") ? rest.indexOf("**", 2) : -1;
  if (end <= 2) return false;
  flushText({ scan });
  scan.nodes.push({ type: "strong", children: parseInline({ source: rest.slice(2, end) }) });
  scan.index += end + 2;
  return true;
}

function scanCode({ scan, rest }: { scan: Scan; rest: string }) {
  const end = rest.startsWith("`") ? rest.indexOf("`", 1) : -1;
  if (end <= 1) return false;
  flushText({ scan });
  scan.nodes.push({ type: "code", value: rest.slice(1, end) });
  scan.index += end + 1;
  return true;
}

function scanLink({ scan, source }: { scan: Scan; source: string }) {
  if (source[scan.index] !== "[") return false;
  const close = closingBracket({ source, from: scan.index + 1 });
  const target = close > 0 ? /^\(([^)\s]+)\)/.exec(source.slice(close + 1)) : null;
  if (!target) return false;
  flushText({ scan });
  scan.nodes.push({
    type: "link",
    href: localHref({ href: target[1] }),
    children: parseInline({ source: source.slice(scan.index + 1, close) }),
  });
  scan.index = close + 1 + target[0].length;
  return true;
}

/** Parses `**strong**`, `` `code` `` and `[label](href)`; anything else stays text. */
export function parseInline({ source }: { source: string }): Inline[] {
  const scan: Scan = { nodes: [], text: "", index: 0 };
  while (scan.index < source.length) {
    const rest = source.slice(scan.index);
    if (scanStrong({ scan, rest }) || scanCode({ scan, rest }) || scanLink({ scan, source })) {
      continue;
    }
    scan.text += source[scan.index];
    scan.index += 1;
  }
  flushText({ scan });
  return scan.nodes;
}

/** The text a reader sees, for labels and metadata. */
export function inlineText({ nodes }: { nodes: Inline[] }): string {
  return nodes
    .map((node) => ("children" in node ? inlineText({ nodes: node.children }) : node.value))
    .join("");
}
