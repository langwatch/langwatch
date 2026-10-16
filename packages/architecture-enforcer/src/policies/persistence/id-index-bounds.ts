import { join } from "node:path";

import ts from "typescript";

import type { ArchitectureViolation, FeatureCatalogueEntry } from "../../types.ts";
import { sourceFile, sourceText } from "../../workspace/module-graph.ts";
import type { WorkspaceSnapshot } from "../../workspace/snapshot.ts";
import {
  collectIdIndexDeclarations,
  type IdIndexDeclarationSite,
  sourceFilesUnder,
} from "./id-index-pairing.ts";

/**
 * A statement over an indexed table that matches its key against a parameter carries the
 * `{{idBound:<table>.<Key>:<param>}}` marker, so the reader bounds it by the id index; a read
 * that is not by id (a list by time range, a fill) says so with `ID_BOUND_SKIP: <reason>`.
 */

const POLICY = "id-index-bounds";
const SKIP = /ID_BOUND_SKIP:\s*\S/;
/** How many lines above a statement its `ID_BOUND_SKIP` comment may sit. */
const SKIP_REACH_LINES = 4;
const ALLOWED =
  "Add {{idBound:<table>.<Key>:<param>}} to the statement, or put `// ID_BOUND_SKIP: <reason>` directly above a read that is not by id (dev/docs/plans/id-index-2026-10-10.md §4).";

/** One statement over an indexed table that matches its key and carries no marker. */
export type UnboundIdRead = { source: string; file: string; line: number };

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

type IndexPattern = { source: string; reads: RegExp; matchesKey: RegExp; marker: string };

/** What a statement over each declared source looks like, and its key matched to a parameter. */
function patternsOf(declarations: readonly IdIndexDeclarationSite[]): IndexPattern[] {
  return declarations.map(({ source, key }) => {
    const columns = key.map(escape).join("|");
    return {
      source,
      reads: new RegExp(
        `\\b(?:FROM|JOIN)\\s+(?:\\$\\{[^}]*\\}\\.)?[\`"]?${escape(source)}[\`"]?(?![\\w])`,
        "i",
      ),
      matchesKey: new RegExp(
        `(?:^|[\\s.(])(?:${columns})\\s*(?:=|IN\\b)\\s*\\(?\\s*(?:\\{\\s*[A-Za-z_]\\w*\\s*:|\\$\\{[^}]*\\}(?!\\.))`,
        "i",
      ),
      marker: `{{idBound:${source}.`,
    };
  });
}

/** The file's `const NAME = "text"` constants, so `FROM ${TABLE_NAME}` reads as its table. */
function stringConstantsOf({ source }: { source: ts.SourceFile }): Map<string, string> {
  const constants = new Map<string, string>();
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      let value = declaration.initializer;
      while (value !== undefined && (ts.isAsExpression(value) || ts.isSatisfiesExpression(value))) {
        value = value.expression;
      }
      if (
        ts.isIdentifier(declaration.name) &&
        value !== undefined &&
        ts.isStringLiteralLike(value)
      ) {
        constants.set(declaration.name.text, value.text);
      }
    }
  }
  return constants;
}

/** A literal's text; an interpolation of a file constant reads as its text, any other as `${}`. */
function literalText({
  node,
  constants,
}: {
  node: ts.Node;
  constants: ReadonlyMap<string, string>;
}): string {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    const spans = node.templateSpans.map((span) => {
      const named = ts.isIdentifier(span.expression)
        ? constants.get(span.expression.text)
        : undefined;
      return `${named ?? "${}"}${span.literal.text}`;
    });
    return [node.head.text, ...spans].join("");
  }
  if (isPlus(node)) {
    return `${literalText({ node: node.left, constants })}${literalText({ node: node.right, constants })}`;
  }
  return " ${} ";
}

const isPlus = (node: ts.Node): node is ts.BinaryExpression =>
  ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken;

function hasStringLeaf(node: ts.Node): boolean {
  if (ts.isStringLiteralLike(node) || ts.isTemplateExpression(node)) return true;
  return isPlus(node) && (hasStringLeaf(node.left) || hasStringLeaf(node.right));
}

/** The top of a `+` chain holding a string, or a lone literal: one statement as written. */
function isStatementRoot(node: ts.Node): boolean {
  if (!hasStringLeaf(node)) return false;
  return node.parent === undefined || !isPlus(node.parent);
}

function skipped({ lines, line }: { lines: readonly string[]; line: number }): boolean {
  const from = Math.max(0, line - 1 - SKIP_REACH_LINES);
  return lines.slice(from, line).some((text) => SKIP.test(text));
}

function reportUnboundReads({
  relevant,
  statement,
  lines,
  line,
  file,
  found,
}: {
  relevant: readonly IndexPattern[];
  statement: string;
  lines: readonly string[];
  line: number;
  file: string;
  found: UnboundIdRead[];
}): void {
  // A source with a second index has a pattern per key; the statement is reported once.
  const reported = new Set<string>();
  for (const pattern of relevant) {
    if (reported.has(pattern.source)) continue;
    if (!pattern.reads.test(statement) || !pattern.matchesKey.test(statement)) continue;
    if (statement.includes(pattern.marker) || skipped({ lines, line })) continue;
    reported.add(pattern.source);
    found.push({ source: pattern.source, file, line });
  }
}

function unboundReadsIn({
  file,
  patterns,
}: {
  file: string;
  patterns: readonly IndexPattern[];
}): UnboundIdRead[] {
  const text = sourceText({ file });
  const relevant = patterns.filter((pattern) => text.includes(pattern.source));
  if (relevant.length === 0) return [];
  const source = sourceFile({ file });
  const constants = stringConstantsOf({ source });
  const lines = text.split("\n");
  const found: UnboundIdRead[] = [];
  const visit = (node: ts.Node): void => {
    if (!isStatementRoot(node)) {
      ts.forEachChild(node, visit);
      return;
    }
    const statement = literalText({ node, constants });
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    reportUnboundReads({ relevant, statement, lines, line, file, found });
  };
  visit(source);
  return found;
}

/** Every unmarked read by id over a declared index, in the modules (eventing reads its own). */
export function collectUnboundIdReads({
  root,
  catalogue,
}: {
  root: string;
  catalogue: readonly FeatureCatalogueEntry[];
}): UnboundIdRead[] {
  const patterns = patternsOf(collectIdIndexDeclarations({ root, catalogue }));
  if (patterns.length === 0) return [];
  const roots = catalogue.map((entry) => join(root, entry.root));
  return sourceFilesUnder({ roots }).flatMap((file) => unboundReadsIn({ file, patterns }));
}

/** The check over a root, for fixtures and the registry entry alike. */
export function lintIdIndexBoundsAt({
  root,
  catalogue,
}: {
  root: string;
  catalogue: readonly FeatureCatalogueEntry[];
}): ArchitectureViolation[] {
  return collectUnboundIdReads({ root, catalogue }).map((read) => ({
    policy: POLICY,
    file: read.file,
    line: read.line,
    message: `This statement reads ${read.source} by its id index's key without {{idBound}}, so the read is not bounded by the index.`,
    allowed: ALLOWED,
  }));
}

/** Every read by id over a declared index carries the marker or a reasoned skip. */
export function lintIdIndexBounds(snapshot: WorkspaceSnapshot): ArchitectureViolation[] {
  return lintIdIndexBoundsAt({ root: snapshot.root, catalogue: snapshot.catalogue });
}
