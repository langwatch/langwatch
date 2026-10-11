/**
 * What every codemod transform shares: the oxc AST helpers, the import bindings, which
 * JSX element resolves to the design system (matched by import as `../census.ts` does),
 * and the edit and skip records a transform hands back.
 */
import { parseSync } from "oxc-parser";

export type AstNode = { type: string; start: number; end: number; [key: string]: unknown };
export type Binding = { source: string; imported: string; local: string; declaration: AstNode };

/** One replacement in the source, by offset. */
export type Edit = { start: number; end: number; text: string };
/** A site the transform found and changed, as the dry run prints it. */
export type Change = { line: number; before: string; after: string };
/** A site the transform found and left alone, with the reason. */
export type Skip = { line: number; snippet: string; reason: string };
export type FileOutcome = { edits: Edit[]; changes: Change[]; skips: Skip[] };

export type Transform = {
  name: string;
  summary: string;
  run: ({ file, source }: { file: string; source: string }) => FileOutcome;
};

export function isNode(value: unknown): value is AstNode {
  return (
    typeof value === "object" && value !== null && typeof Reflect.get(value, "type") === "string"
  );
}
export const child = (node: AstNode | undefined, key: string): AstNode | undefined => {
  const value = node?.[key];
  return isNode(value) ? value : undefined;
};
export const children = (node: AstNode | undefined, key: string): AstNode[] => {
  const value = node?.[key];
  return Array.isArray(value) ? value.filter(isNode) : [];
};
export const text = (node: AstNode | undefined, key: string): string | undefined => {
  const value = node?.[key];
  return typeof value === "string" ? value : undefined;
};

/** Every child node, in source order. */
export function childNodes({ node }: { node: AstNode }): AstNode[] {
  const out: AstNode[] = [];
  for (const value of Object.values(node)) {
    if (isNode(value)) out.push(value);
    if (Array.isArray(value)) out.push(...value.filter(isNode));
  }
  return out.toSorted((a, b) => a.start - b.start);
}

export type Parsed = {
  program: AstNode;
  source: string;
  lineOf: ({ offset }: { offset: number }) => number;
  snippetOf: ({ node }: { node: AstNode }) => string;
  bindings: Map<string, Binding>;
};

export function parse({ file, source }: { file: string; source: string }): Parsed {
  const { program, errors } = parseSync(file, source, {
    lang: file.endsWith(".tsx") ? "tsx" : "ts",
  });
  if (errors.length) throw new Error(`Cannot parse ${file}: ${errors[0]?.message}`);
  if (!isNode(program)) throw new Error(`Cannot parse ${file}: no program`);
  const lineStarts = [0];
  for (const match of source.matchAll(/\n/g)) lineStarts.push(match.index + 1);
  const lineOf = ({ offset }: { offset: number }) => {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if ((lineStarts[mid] ?? 0) <= offset) low = mid;
      else high = mid - 1;
    }
    return low + 1;
  };
  const snippetOf = ({ node }: { node: AstNode }) =>
    source.slice(node.start, node.end).replace(/\s+/g, " ").slice(0, 80);
  return { program, source, lineOf, snippetOf, bindings: importBindings({ program }) };
}

function importBindings({ program }: { program: AstNode }): Map<string, Binding> {
  const bindings = new Map<string, Binding>();
  for (const declaration of children(program, "body")) {
    if (declaration.type !== "ImportDeclaration") continue;
    const source = text(child(declaration, "source"), "value") ?? "";
    for (const specifier of children(declaration, "specifiers")) {
      const local = text(child(specifier, "local"), "name");
      if (!local) continue;
      const imported = child(specifier, "imported");
      const name = text(imported, "name") ?? text(imported, "value") ?? local;
      bindings.set(local, { source, imported: name, local, declaration });
    }
  }
  return bindings;
}

/** Design-system entries, its primitives and Chakra itself all take style props. */
export const isDesignSystemSource = (source: string) =>
  source.startsWith("@langwatch/design-system") || source === "@chakra-ui/react";
export const isLocalSource = (source: string) => /^(\.|~\/|@\/)/.test(source);

/** `<Card.Body>` reads `Card.Body`, with the import binding of `Card`. */
export function resolveElement({
  parsed,
  opening,
}: {
  parsed: Parsed;
  opening: AstNode;
}): { ref: string; binding?: Binding } | undefined {
  const members: string[] = [];
  let cursor = child(opening, "name");
  while (cursor?.type === "JSXMemberExpression") {
    members.unshift(text(child(cursor, "property"), "name") ?? "");
    cursor = child(cursor, "object");
  }
  const local = text(cursor, "name");
  if (!local) return undefined;
  const binding = parsed.bindings.get(local);
  return { ref: [binding?.imported ?? local, ...members].join("."), binding };
}

/** Applies non-overlapping edits from the end, so earlier offsets stay valid. */
export function applyEdits({ source, edits }: { source: string; edits: Edit[] }): string {
  let out = source;
  let floor = Number.POSITIVE_INFINITY;
  for (const edit of edits.toSorted((a, b) => b.start - a.start)) {
    if (edit.end > floor) throw new Error(`Overlapping edits at offset ${edit.start}`);
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
    floor = edit.start;
  }
  return out;
}
