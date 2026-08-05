import ts from "typescript";

/**
 * Static scan for the deleteMany collapse (#6219) in test files.
 *
 * The dangerous form is a `deleteMany` whose filter references a
 * reassignable variable: `let orgId: string` assigned inside `beforeAll`
 * is `undefined` whenever setup threw first, Prisma drops `undefined`
 * from the where clause, and the delete matches every row in the table.
 * TypeScript cannot flag it, because definite-assignment analysis stops
 * at the callback boundary. Module-level `const` ids (ksuids generated at
 * import time) cannot be undefined and pass.
 *
 * Enforced from `__tests__/teardownScan.unit.test.ts`, which pins the rule
 * on snippets and then runs it over every test file under `src`, `ee`, and
 * `packages`, so the check rides the ordinary unit shards instead of a
 * gate nobody notices has stopped checking (#6169).
 *
 * Spec: specs/setup/test-teardown-safety.feature
 */

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
function reassignableNamesIn(node: ts.Node): string[] {
  if (!ts.isVariableDeclarationList(node)) return [];
  if ((node.flags & ts.NodeFlags.Const) !== 0) return [];
  const names: string[] = [];
  for (const declaration of node.declarations) {
    if (ts.isIdentifier(declaration.name)) names.push(declaration.name.text);
  }
  return names;
}

/** Mutability of every simple `let`/`var` declaration in the file. */
function collectReassignableNames(source: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    for (const name of reassignableNamesIn(node)) names.add(name);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return names;
}

function unwrapExpression(node: ts.Expression): ts.Expression {
  let current = node;
  while (
    ts.isNonNullExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isParenthesizedExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function lineOf(source: ts.SourceFile, node: ts.Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

function modelNameOf(callee: ts.PropertyAccessExpression): string {
  const owner = unwrapExpression(callee.expression);
  if (ts.isPropertyAccessExpression(owner)) return owner.name.text;
  if (ts.isIdentifier(owner)) return owner.text;
  return "<unknown>";
}

/** One filter expression under judgement, plus where to report it. */
type WhereCheck = {
  expression: ts.Expression;
  reassignable: Set<string>;
  source: ts.SourceFile;
  model: string;
  violations: TeardownViolation[];
};

/** A bare identifier is safe only when nothing can reassign it. */
function checkIdentifierFilter(value: ts.Identifier, check: WhereCheck): void {
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
function filterValueOf(
  property: ts.ObjectLiteralElementLike,
): ts.Expression | undefined {
  if (ts.isPropertyAssignment(property)) return property.initializer;
  if (ts.isShorthandPropertyAssignment(property)) return property.name;
  // `{ ...filterVars }` merges the whole object in, so what it merges is
  // itself a filter value, the same way an array spread's target is.
  if (ts.isSpreadAssignment(property)) return property.expression;
  return undefined;
}

function checkObjectFilter(
  value: ts.ObjectLiteralExpression,
  check: WhereCheck,
): void {
  for (const property of value.properties) {
    const target = filterValueOf(property);
    if (target) checkWhereExpression({ ...check, expression: target });
  }
}

function checkListFilter(
  value: ts.ArrayLiteralExpression,
  check: WhereCheck,
): void {
  for (const element of value.elements) {
    // `{ in: [...teamIds] }` spreads a reassignable array into the list:
    // check the spread expression itself, not the (nonexistent) element it
    // would otherwise be treated as.
    const target = ts.isSpreadElement(element) ? element.expression : element;
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

  if (ts.isIdentifier(value)) {
    checkIdentifierFilter(value, check);
    return;
  }
  if (ts.isObjectLiteralExpression(value)) {
    checkObjectFilter(value, check);
    return;
  }
  if (ts.isArrayLiteralExpression(value)) {
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
  argument: ts.Expression | undefined;
  line: number;
  model: string;
  reassignable: Set<string>;
  source: ts.SourceFile;
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
  if (!ts.isObjectLiteralExpression(argumentValue)) {
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
    (property): property is ts.PropertyAssignment =>
      ts.isPropertyAssignment(property) &&
      ts.isIdentifier(property.name) &&
      property.name.text === "where",
  );
  if (!whereProperty) {
    violations.push({
      line,
      variable: "<none>",
      model,
      reason:
        "deleteMany without a where clause deletes every row in the table",
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
 * Scan one test file's source for unsafe deleteMany calls. Pure: takes
 * text, returns violations, so the rule itself is unit-testable.
 */
export function scanTestSourceForUnsafeDeleteMany(
  fileName: string,
  sourceText: string,
): TeardownViolation[] {
  const source = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
  );
  const reassignable = collectReassignableNames(source);
  const violations: TeardownViolation[] = [];

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "deleteMany"
    ) {
      checkDeleteManyArgument({
        argument: node.arguments[0],
        line: lineOf(source, node),
        model: modelNameOf(node.expression),
        reassignable,
        source,
        violations,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  return violations;
}
