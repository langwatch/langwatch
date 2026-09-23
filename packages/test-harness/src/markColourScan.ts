import type {
  Expression,
  Identifier,
  JsxAttribute,
  Node,
  PropertyAssignment,
  SourceFile,
  StringLiteral,
  VariableDeclaration,
} from "typescript/unstable/ast";
import {
  isConditionalExpression,
  isIdentifier,
  isJsxAttribute,
  isJsxExpression,
  isPropertyAssignment,
  isStringLiteral,
  isVariableDeclaration,
} from "typescript/unstable/ast";

/**
 * Static scan for mark colours: parser-based (not regex). Handles
 * constants/ternaries/spellings. Same-file resolution. See ADR-099.
 */

/** An attribute or property whose value paints a mark. */
export const MARK_ROLES = new Set([
  "stroke",
  "fill",
  "backgroundColor",
  "background",
  "bgColor",
  "bg",
  "trackColor",
  "colorPalette",
]);

/**
 * Mark name pattern: stroke/fill/ink suffix (not bare Color). Catches
 * top-level exports the scan originally missed.
 */
const MARK_NAME = /(?:^|_|[a-z])(?:stroke|fill|ink)s?$/i;

export type MarkColourSite =
  /** The colour is a literal the parser can hand back. */
  | { kind: "literal"; role: string; value: string; line: number }
  /**
   * The role is used, and no static answer exists — an import, a call, a
   * property read, a template. Named rather than skipped: this is the set a
   * caller must decide about, not a set it may ignore.
   */
  | { kind: "unresolved"; role: string; text: string; line: number };

/**
 * Every declaration in the file that binds a name to a string literal, so `stroke={SPARK}` can be
 * answered. Both `const SPARK = "..."` and the string members of `const THEME = { stroke: "..." }`
 * are recorded, the latter under `THEME.stroke`, because that is how a caller writes the reference.
 */
function isNamedVariableDeclaration(
  node: Node,
): node is VariableDeclaration & { name: Identifier } {
  return isVariableDeclaration(node) && !!node.name && isIdentifier(node.name);
}

function isNamedPropertyAssignment(node: Node): node is PropertyAssignment & { name: Identifier } {
  return isPropertyAssignment(node) && isIdentifier(node.name);
}

function isStringPropertyAssignment(
  node: Node,
): node is PropertyAssignment & { name: Identifier; initializer: StringLiteral } {
  return isNamedPropertyAssignment(node) && isStringLiteral(node.initializer);
}

function isNamedJsxAttribute(node: Node): node is JsxAttribute & { name: Identifier } {
  return isJsxAttribute(node) && isIdentifier(node.name);
}

function isMarkNameDeclaration(
  node: Node,
): node is VariableDeclaration & { name: Identifier; initializer: Expression } {
  return isNamedVariableDeclaration(node) && !!node.initializer && MARK_NAME.test(node.name.text);
}

function stringDeclarations(source: SourceFile): Map<string, string> {
  const table = new Map<string, string>();

  const visit = (node: Node): void => {
    if (isNamedVariableDeclaration(node)) {
      const name = node.name.text;
      const init = node.initializer;

      if (init && isStringLiteral(init)) {
        table.set(name, init.text);
      } else if (init) {
        // The compiler hands back a remote node list rather than an array, so
        // the members are walked through the API rather than indexed.
        init.forEachChild((property) => {
          if (isStringPropertyAssignment(property)) {
            table.set(`${name}.${property.name.text}`, property.initializer.text);
          }
        });
      }
    }

    node.forEachChild(visit);
  };

  visit(source);
  return table;
}

/** The text a node occupies, for reporting something a human can find. */
function textOf(source: SourceFile, node: Node): string {
  return source
    .getText()
    .slice(node.getStart(source), node.getEnd())
    .replace(/\s+/g, " ")
    .slice(0, 80);
}

function lineOf(source: SourceFile, node: Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

/**
 * The colours one expression can produce. A ternary yields BOTH branches,
 * which is the whole reason this returns a list rather than a value: a mark
 * that is forbidden down one path is forbidden.
 */
function coloursOf(
  expression: Expression,
  declarations: Map<string, string>,
): { values: string[]; resolved: boolean } {
  if (isStringLiteral(expression)) {
    return { values: [expression.text], resolved: true };
  }

  if (isIdentifier(expression)) {
    const value = declarations.get(expression.text);
    return value === undefined
      ? { values: [], resolved: false }
      : { values: [value], resolved: true };
  }

  if (isConditionalExpression(expression)) {
    const whenTrue = coloursOf(expression.whenTrue, declarations);
    const whenFalse = coloursOf(expression.whenFalse, declarations);
    return {
      values: [...whenTrue.values, ...whenFalse.values],
      // A branch nobody can read makes the whole ternary unresolved, so a
      // caller cannot be reassured by the half that happened to be legible.
      resolved: whenTrue.resolved && whenFalse.resolved,
    };
  }

  return { values: [], resolved: false };
}

/**
 * Every place this file paints a mark, with the colour where one can be read
 * statically and an explicit admission where it cannot.
 */
export function markColourSites(source: SourceFile): MarkColourSite[] {
  const declarations = stringDeclarations(source);
  const sites: MarkColourSite[] = [];

  const record = (role: string, value: Expression | undefined, node: Node) => {
    if (!MARK_ROLES.has(role) || !value) return;

    const { values, resolved } = coloursOf(value, declarations);

    for (const found of values) {
      sites.push({
        kind: "literal",
        role,
        value: found,
        line: lineOf(source, node),
      });
    }

    if (!resolved) {
      sites.push({
        kind: "unresolved",
        role,
        text: textOf(source, node),
        line: lineOf(source, node),
      });
    }
  };

  /** `<Line stroke="..." />` and `<Line stroke={...} />` alike. */
  const fromAttribute = (node: Node): void => {
    if (!isNamedJsxAttribute(node)) return;

    const initializer = node.initializer;
    if (!initializer) return;

    if (isStringLiteral(initializer)) {
      record(node.name.text, initializer, node);
    } else if (isJsxExpression(initializer) && initializer.expression) {
      record(node.name.text, initializer.expression, node);
    }
  };

  /** `{ stroke: "..." }`, the form a shared theme constant takes. */
  const fromProperty = (node: Node): void => {
    if (isNamedPropertyAssignment(node)) {
      record(node.name.text, node.initializer, node);
    }
  };

  /**
   * `export const CHART_SPARK_STROKE = "..."` — a mark colour that touches no attribute in the file
   * declaring it, because its consumers import it. The role is the declaration's own name. Bypasses
   * `record`, whose role check is the attribute vocabulary rather than this one.
   */
  const fromDeclaration = (node: Node): void => {
    if (!isMarkNameDeclaration(node)) return;

    const role = node.name.text;
    const { values, resolved } = coloursOf(node.initializer, declarations);

    for (const found of values) {
      sites.push({
        kind: "literal",
        role,
        value: found,
        line: lineOf(source, node),
      });
    }

    if (!resolved) {
      sites.push({
        kind: "unresolved",
        role,
        text: textOf(source, node),
        line: lineOf(source, node),
      });
    }
  };

  const visit = (node: Node): void => {
    fromAttribute(node);
    fromProperty(node);
    fromDeclaration(node);
    node.forEachChild(visit);
  };

  visit(source);
  return sites;
}
