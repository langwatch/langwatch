import type { Expression, Node, SourceFile } from "typescript/unstable/ast";
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
 * Static scan for the colour a chart mark is painted in.
 *
 * A mark is a drawn thing — a line, an area, a bar, a swatch. The rules it
 * answers to live in `specs/ai-governance/dashboard/governance-ui-controls.feature`.
 * This module only finds the colours and says where they came from; the tests
 * decide which ones are allowed.
 *
 * **Why this parses instead of matching text.** The first version of this
 * check was a regular expression, and every one of these defeated it, each
 * found by an adversarial reader rather than by the author:
 *
 *   - `stroke={SOME_CONST}`, where the constant is declared elsewhere in the
 *     file and holds the forbidden value;
 *   - `fill={flag ? ALLOWED : FORBIDDEN}`, where only one branch offends;
 *   - an attribute spelling nobody enumerated — `bgColor`, `trackColor`,
 *     `background`, `colorPalette` all mean the same thing to different
 *     components;
 *   - the same colour written as a design token rather than as the CSS
 *     variable the token compiles to, which is a different string for an
 *     identical pixel;
 *   - a multi-line attribute, where a line-oriented reader saw the name on one
 *     line and the value on another and joined neither.
 *
 * A parser is immune to all five by construction, because it is reading the
 * shape of the code rather than the shape of the text. That is the point of
 * spending a compiler session on it.
 *
 * **What it still cannot do, said out loud.** It resolves an identifier only
 * to a declaration in the SAME file. A value imported from another module, a
 * property read off an object, a template string, a function call — none of
 * these have a static answer here, and every one is reported as
 * `kind: "unresolved"` rather than quietly treated as clean. A caller that
 * ignores the unresolved list has a guard with a hole in it, and the hole is
 * visible in the return value rather than buried in a regex.
 *
 * Built on `tsAst`, which owns the one compiler session. See ADR-099.
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
 * A constant whose NAME says it holds a mark colour — `CHART_SPARK_STROKE`,
 * `PROJECTION_INK`, `seriesFill`.
 *
 * This exists because leaving it out made the whole scan worthless in a way no
 * amount of reading would have shown. A falsification sweep put eight forbidden
 * values on `CHART_SPARK_STROKE`, the single most important mark colour in the
 * section, and all eight passed: a top-level `export const` is neither a JSX
 * attribute nor a property assignment, so nothing looked at it. The scan was
 * reading everywhere except the place the rule is about.
 *
 * Only the words that mean DRAWING are here. A bare `...Color` suffix was tried
 * and removed: `trendColor` on the teams screen holds the colour of a trend
 * arrow's TEXT, where a muted grey for "no baseline yet" is correct and a green
 * for a downward trend is required by
 * `specs/ai-gateway/governance/birds-eye-dashboard-v2.feature`. Reading it as a
 * mark reported a settled rule as a defect. "Colour" is the generic word and
 * covers text; stroke, fill and ink are the words for painting a shape.
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
 * Every declaration in the file that binds a name to a string literal, so
 * `stroke={SPARK}` can be answered. Both `const SPARK = "..."` and the string
 * members of `const THEME = { stroke: "..." }` are recorded, the latter under
 * `THEME.stroke`, because that is how a caller writes the reference.
 */
function stringDeclarations(source: SourceFile): Map<string, string> {
  const table = new Map<string, string>();

  const visit = (node: Node): void => {
    if (isVariableDeclaration(node) && node.name && isIdentifier(node.name)) {
      const name = node.name.text;
      const init = node.initializer;

      if (init && isStringLiteral(init)) {
        table.set(name, init.text);
      } else if (init) {
        // The compiler hands back a remote node list rather than an array, so
        // the members are walked through the API rather than indexed.
        init.forEachChild((property) => {
          if (
            isPropertyAssignment(property) &&
            isIdentifier(property.name) &&
            isStringLiteral(property.initializer)
          ) {
            table.set(
              `${name}.${property.name.text}`,
              property.initializer.text,
            );
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
    if (!isJsxAttribute(node) || !isIdentifier(node.name)) return;

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
    if (isPropertyAssignment(node) && isIdentifier(node.name)) {
      record(node.name.text, node.initializer, node);
    }
  };

  /**
   * `export const CHART_SPARK_STROKE = "..."` — a mark colour that touches no
   * attribute in the file declaring it, because its consumers import it. The
   * role is the declaration's own name. Bypasses `record`, whose role check is
   * the attribute vocabulary rather than this one.
   */
  const fromDeclaration = (node: Node): void => {
    if (
      !isVariableDeclaration(node) ||
      !node.name ||
      !isIdentifier(node.name) ||
      !node.initializer ||
      !MARK_NAME.test(node.name.text)
    ) {
      return;
    }

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
