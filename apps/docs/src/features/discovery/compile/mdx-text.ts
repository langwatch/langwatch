// Markdown as lines: fenced code kept byte for byte, MDX comments and statements dropped,
// whitespace squeezed, and the heading a section level writes.

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

export type MarkedLine = { text: string; code: boolean; opens: boolean; closes: boolean };

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
export function dropComments({ source }: { source: string }) {
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
export function segments({ source }: { source: string }) {
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
export function dropStatements({ source }: { source: string }) {
  return mapProse({ source, line: (text) => (MDX_STATEMENT.test(text) ? null : text) });
}

/** Lines less their shared leading whitespace, as MDX reads content nested in a component. */
export function dedent({ text }: { text: string }) {
  const lines = text.split("\n");
  const indents = lines
    .filter((line) => line.trim())
    .map((line) => /^\s*/.exec(line)?.[0].length ?? 0);
  const shared = indents.length ? Math.min(...indents) : 0;
  return lines.map((line) => (line.trim() ? line.slice(shared) : "")).join("\n");
}

/** Removes repeated blank lines and whitespace-only lines outside code. */
export function squeeze({ source }: { source: string }) {
  const lines: string[] = [];
  for (const line of markedLines({ source })) {
    const blank = !line.code && line.text.trim() === "";
    if (blank && (lines.length === 0 || lines[lines.length - 1] === "")) continue;
    lines.push(blank ? "" : line.text);
  }
  return lines.join("\n");
}

/** `level` is the heading level of the section a component sits in; the page title is 1. */
export type Context = { level: number };

export function heading({ context, title }: { context: Context; title: string }) {
  return `${"#".repeat(Math.min(context.level + 1, 6))} ${title}`;
}
