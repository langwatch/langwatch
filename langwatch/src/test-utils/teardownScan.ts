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
 * on snippets and then runs it over every test file in the repository, so
 * the check rides the ordinary unit shards instead of a gate nobody
 * notices has stopped checking (#6169).
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

/** Mutability of every simple `let`/`var` declaration in the file. */
function collectReassignableNames(source: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclarationList(node)) {
      const isConst = (node.flags & ts.NodeFlags.Const) !== 0;
      if (!isConst) {
        for (const declaration of node.declarations) {
          if (ts.isIdentifier(declaration.name)) {
            names.add(declaration.name.text);
          }
        }
      }
    }
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

/**
 * Walk a where-object expression and report every reassignable identifier
 * used as a filter value, at any depth (a `let` inside `{ in: teamIds }`
 * collapses exactly like a bare one).
 */
function checkWhereExpression({
  expression,
  reassignable,
  source,
  model,
  line,
  violations,
}: {
  expression: ts.Expression;
  reassignable: Set<string>;
  source: ts.SourceFile;
  model: string;
  line: number;
  violations: TeardownViolation[];
}): void {
  const value = unwrapExpression(expression);

  if (ts.isIdentifier(value)) {
    if (reassignable.has(value.text)) {
      violations.push({
        line: lineOf(source, value),
        variable: value.text,
        model,
        reason:
          `"${value.text}" is declared with let/var, so it is undefined ` +
          "whenever setup threw before assigning it, and Prisma then " +
          "drops it from the filter and matches every row",
      });
    }
    return;
  }

  if (ts.isObjectLiteralExpression(value)) {
    for (const property of value.properties) {
      if (ts.isPropertyAssignment(property)) {
        checkWhereExpression({
          expression: property.initializer,
          reassignable,
          source,
          model,
          line,
          violations,
        });
      } else if (ts.isShorthandPropertyAssignment(property)) {
        checkWhereExpression({
          expression: property.name,
          reassignable,
          source,
          model,
          line,
          violations,
        });
      }
    }
    return;
  }

  if (ts.isArrayLiteralExpression(value)) {
    for (const element of value.elements) {
      checkWhereExpression({
        expression: element,
        reassignable,
        source,
        model,
        line,
        violations,
      });
    }
  }
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
      const model = modelNameOf(node.expression);
      const line = lineOf(source, node);
      const argument = node.arguments[0];

      if (!argument) {
        violations.push({
          line,
          variable: "<none>",
          model,
          reason: "deleteMany with no filter deletes every row in the table",
        });
      } else {
        const argumentValue = unwrapExpression(argument);
        if (ts.isObjectLiteralExpression(argumentValue)) {
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
          } else {
            checkWhereExpression({
              expression: whereProperty.initializer,
              reassignable,
              source,
              model,
              line,
              violations,
            });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  return violations;
}
