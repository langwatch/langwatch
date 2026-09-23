import type {
  ArrayLiteralExpression,
  AsExpression,
  Expression,
  Identifier,
  Node,
  NonNullExpression,
  ObjectLiteralElementLike,
  ObjectLiteralExpression,
  ParenthesizedExpression,
  PropertyAccessExpression,
  PropertyAssignment,
  SatisfiesExpression,
  SourceFile,
} from "typescript/unstable/ast";
import {
  isArrayLiteralExpression,
  isAsExpression,
  isCallExpression,
  isIdentifier,
  isNonNullExpression,
  isObjectLiteralExpression,
  isParenthesizedExpression,
  isPropertyAccessExpression,
  isPropertyAssignment,
  isSatisfiesExpression,
  isShorthandPropertyAssignment,
  isSpreadAssignment,
  isSpreadElement,
  isVariableDeclarationList,
  NodeFlags,
} from "typescript/unstable/ast";

// Scan for deleteMany with reassignable filters that could be undefined
// (TypeScript cannot detect this); module-level const ids are safe.

export type TeardownViolation = {
  /** 1-based line of the offending deleteMany call. */
  line: number;
  /** The variable (or "<none>" for an unfiltered delete). */
  variable: string;
  /** Best-effort model name, e.g. "team" out of `prisma.team.deleteMany`. */
  model: string;
  reason: string;
};

/** Names one `let`/`var` declaration list binds. `const` binds none. */
function reassignableNamesIn(node: Node): string[] {
  if (!isVariableDeclarationList(node)) return [];
  if ((node.flags & NodeFlags.Const) !== 0) return [];
  const names: string[] = [];
  for (const declaration of node.declarations) {
    if (isIdentifier(declaration.name)) names.push(declaration.name.text);
  }
  return names;
}

/** Mutability of every simple `let`/`var` declaration in the file. */
function collectReassignableNames(source: SourceFile): Set<string> {
  const names = new Set<string>();
  const visit = (node: Node): void => {
    for (const name of reassignableNamesIn(node)) names.add(name);
    node.forEachChild(visit);
  };
  visit(source);
  return names;
}

function isExpressionWrapper(
  node: Expression,
): node is NonNullExpression | AsExpression | ParenthesizedExpression | SatisfiesExpression {
  return (
    isNonNullExpression(node) ||
    isAsExpression(node) ||
    isParenthesizedExpression(node) ||
    isSatisfiesExpression(node)
  );
}

function unwrapExpression(node: Expression): Expression {
  let current = node;
  while (isExpressionWrapper(current)) {
    current = current.expression;
  }
  return current;
}

function lineOf(source: SourceFile, node: Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

// Model that deleteMany targets; bare identifiers have no model segment
// and are skipped to avoid false positives on internal deleteMany methods.
function modelDelegateNameOf(callee: PropertyAccessExpression): string | undefined {
  const owner = unwrapExpression(callee.expression);
  if (isIdentifier(owner)) return undefined;
  if (isPropertyAccessExpression(owner)) return owner.name.text;
  return "<unknown>";
}

/** One filter expression under judgement, plus where to report it. */
type WhereCheck = {
  expression: Expression;
  reassignable: Set<string>;
  source: SourceFile;
  model: string;
  violations: TeardownViolation[];
};

/** A bare identifier is safe only when nothing can reassign it. */
function checkIdentifierFilter(value: Identifier, check: WhereCheck): void {
  if (!check.reassignable.has(value.text)) return;
  check.violations.push({
    line: lineOf(check.source, value),
    variable: value.text,
    model: check.model,
    reason:
      `"${value.text}" is declared with let/var, so it is undefined ` +
      "whenever setup threw before assigning it, and Prisma then " +
      "drops it from the filter and matches every row",
  });
}

/**
 * The expression carrying a filter value out of one object-literal property,
 * or undefined for a property shape that carries none.
 */
function filterValueOf(property: ObjectLiteralElementLike): Expression | undefined {
  if (isPropertyAssignment(property)) return property.initializer;
  // TypeScript 7 types a shorthand property's name as `PropertyName`, which
  // admits a computed name — a shape the grammar does not allow here, but one
  // the type has to account for. Narrowing to the identifier is what the value
  // always was.
  if (isShorthandPropertyAssignment(property)) {
    return isIdentifier(property.name) ? property.name : undefined;
  }
  // `{ ...filterVars }` merges the whole object in, so what it merges is
  // itself a filter value, the same way an array spread's target is.
  if (isSpreadAssignment(property)) return property.expression;
  return undefined;
}

function checkObjectFilter(value: ObjectLiteralExpression, check: WhereCheck): void {
  for (const property of value.properties) {
    const target = filterValueOf(property);
    if (target) checkWhereExpression({ ...check, expression: target });
  }
}

function checkListFilter(value: ArrayLiteralExpression, check: WhereCheck): void {
  for (const element of value.elements) {
    // `{ in: [...teamIds] }` spreads a reassignable array into the list:
    // check the spread expression itself, not the (nonexistent) element it
    // would otherwise be treated as.
    const target = isSpreadElement(element) ? element.expression : element;
    checkWhereExpression({ ...check, expression: target });
  }
}

/**
 * Walk a where-object expression and report every reassignable identifier
 * used as a filter value, at any depth (a `let` inside `{ in: teamIds }`
 * collapses exactly like a bare one).
 */
function checkWhereExpression(check: WhereCheck): void {
  const value = unwrapExpression(check.expression);

  if (isIdentifier(value)) {
    checkIdentifierFilter(value, check);
    return;
  }
  if (isObjectLiteralExpression(value)) {
    checkObjectFilter(value, check);
    return;
  }
  if (isArrayLiteralExpression(value)) {
    checkListFilter(value, check);
  }
}

/**
 * Judge one deleteMany call's argument: it is safe only when an inline
 * object literal carries a `where` whose every filter value is proven
 * assigned.
 */
function checkDeleteManyArgument({
  argument,
  line,
  model,
  reassignable,
  source,
  violations,
}: {
  argument: Expression | undefined;
  line: number;
  model: string;
  reassignable: Set<string>;
  source: SourceFile;
  violations: TeardownViolation[];
}): void {
  if (!argument) {
    violations.push({
      line,
      variable: "<none>",
      model,
      reason: "deleteMany with no filter deletes every row in the table",
    });
    return;
  }

  const argumentValue = unwrapExpression(argument);
  if (!isObjectLiteralExpression(argumentValue)) {
    // A variable, call result, or spread standing in for the whole args
    // object: this scanner only proves safety for an inline literal, so
    // anything else cannot be told apart from an unfiltered delete.
    violations.push({
      line,
      variable: "<none>",
      model,
      reason:
        "deleteMany argument is not an inline object literal, so this scanner cannot verify its filter is safe",
    });
    return;
  }

  const whereProperty = argumentValue.properties.find(
    (property): property is PropertyAssignment =>
      isPropertyAssignment(property) &&
      isIdentifier(property.name) &&
      property.name.text === "where",
  );
  if (!whereProperty) {
    violations.push({
      line,
      variable: "<none>",
      model,
      reason: "deleteMany without a where clause deletes every row in the table",
    });
    return;
  }

  checkWhereExpression({
    expression: whereProperty.initializer,
    reassignable,
    source,
    model,
    violations,
  });
}

/**
 * Scan one parsed test file for unsafe deleteMany calls — pure, taking a
 * syntax tree, so it's unit-testable. Parsing is the caller's job: TS7
 * parses in the compiler process, so `parseSourceTexts` batches every file into one exchange.
 */
export function scanTestSourceForUnsafeDeleteMany(source: SourceFile): TeardownViolation[] {
  const reassignable = collectReassignableNames(source);
  const violations: TeardownViolation[] = [];

  const visit = (node: Node): void => {
    if (
      isCallExpression(node) &&
      isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "deleteMany"
    ) {
      const model = modelDelegateNameOf(node.expression);
      if (model !== undefined) {
        checkDeleteManyArgument({
          argument: node.arguments[0],
          line: lineOf(source, node),
          model,
          reassignable,
          source,
          violations,
        });
      }
    }
    node.forEachChild(visit);
  };
  visit(source);

  return violations;
}
