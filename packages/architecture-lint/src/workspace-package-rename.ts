import { extname } from "node:path";
import ts from "typescript";

const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
]);
const JSON_EXTENSIONS = new Set([".json", ".jsonc"]);

type TextEdit = { start: number; end: number; text: string };

function replacement(value: string, from: string, to: string): string | undefined {
  if (value === from) return to;
  if (value.startsWith(`${from}/`)) return `${to}${value.slice(from.length)}`;
  return undefined;
}

function quoteLike(source: string, node: ts.Node, value: string): string {
  const original = source.slice(node.getStart(), node.getEnd());
  const quote = original[0] === "'" ? "'" : '"';
  const escaped = value.replaceAll("\\", "\\\\").replaceAll(quote, `\\${quote}`);
  return `${quote}${escaped}${quote}`;
}

function sourceEdits(
  file: string,
  source: string,
  from: string,
  to: string,
  allStringLiterals: boolean,
): TextEdit[] {
  const kind =
    file.endsWith(".tsx") || file.endsWith(".jsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    kind,
  );
  const edits: TextEdit[] = [];
  const editedStarts = new Set<number>();
  const add = (node: ts.Node | undefined) => {
    if (!node || !ts.isStringLiteralLike(node)) return;
    const next = replacement(node.text, from, to);
    if (next === undefined) return;
    const start = node.getStart(sourceFile);
    if (editedStarts.has(start)) return;
    editedStarts.add(start);
    edits.push({
      start,
      end: node.getEnd(),
      text: quoteLike(source, node, next),
    });
  };
  const visit = (node: ts.Node): void => {
    if (allStringLiterals && ts.isStringLiteralLike(node)) {
      add(node);
    } else if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      add(node.moduleSpecifier);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      add(node.moduleReference.expression);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      add(node.argument.literal);
    } else if (ts.isCallExpression(node)) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire =
        ts.isIdentifier(node.expression) && node.expression.text === "require";
      if (isDynamicImport || isRequire) add(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return edits;
}

function jsonEdits(file: string, source: string, from: string, to: string): TextEdit[] {
  const sourceFile = ts.parseJsonText(file, source);
  const edits: TextEdit[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node)) {
      const next = replacement(node.text, from, to);
      if (next !== undefined) {
        edits.push({
          start: node.getStart(sourceFile),
          end: node.getEnd(),
          text: JSON.stringify(next),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return edits;
}

function applyEdits(source: string, edits: TextEdit[]): string {
  return [...edits]
    .sort((left, right) => right.start - left.start)
    .reduce(
      (result, edit) =>
        `${result.slice(0, edit.start)}${edit.text}${result.slice(edit.end)}`,
      source,
    );
}

export function renameWorkspaceReference(input: {
  file: string;
  source: string;
  from: string;
  to: string;
  allStringLiterals?: boolean;
}): string {
  const extension = extname(input.file);
  if (SOURCE_EXTENSIONS.has(extension)) {
    return applyEdits(
      input.source,
      sourceEdits(
        input.file,
        input.source,
        input.from,
        input.to,
        input.allStringLiterals ?? false,
      ),
    );
  }
  if (JSON_EXTENSIONS.has(extension)) {
    return applyEdits(
      input.source,
      jsonEdits(input.file, input.source, input.from, input.to),
    );
  }
  return input.source.split(input.from).join(input.to);
}
