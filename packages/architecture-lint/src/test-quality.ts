import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import ts from "typescript";
import type { ArchitectureViolation } from "./types";

const TEST_FILE = /(?:^|\/)\S+\.(?:test|spec)\.[cm]?[jt]sx?$/;
const TEST_CALLBACKS = new Set(["it", "test"]);
const SUITE_CALLBACKS = new Set(["describe", "suite"]);
const EXPECTATION_CALLEES = new Set(["expect", "expectTypeOf"]);
const ASSERTION_NAMESPACES = new Set(["assert", "chai"]);
const STATIC_MATCHERS = new Set([
  "toBe",
  "toEqual",
  "toStrictEqual",
  "toBeTruthy",
  "toBeFalsy",
  "toBeDefined",
  "toBeUndefined",
  "toBeNull",
]);
const SNAPSHOT_MATCHERS = new Set(["toMatchSnapshot", "toMatchInlineSnapshot"]);

export type TestQualityLintOptions = {
  files?: readonly string[];
};

type TestCall = {
  callback: TestCallback;
  call: ts.CallExpression;
  scope: string;
};

type TestCallback = ts.ArrowFunction | ts.FunctionExpression;

type ImportBinding = {
  name: string;
  module: string;
};

function lineOf(source: ts.SourceFile, node: ts.Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

function isTestFile(file: string): boolean {
  return TEST_FILE.test(file.replaceAll("\\", "/"));
}

function baseCalleeName(expression: ts.Expression): string | undefined {
  let current = expression;
  while (true) {
    if (ts.isPropertyAccessExpression(current)) {
      current = current.expression;
      continue;
    }
    if (ts.isCallExpression(current)) {
      current = current.expression;
      continue;
    }
    break;
  }
  return ts.isIdentifier(current) ? current.text : void 0;
}

function callbackFromCall(
  call: ts.CallExpression,
  names: ReadonlySet<string>,
): TestCallback | undefined {
  const callee = baseCalleeName(call.expression);
  if (!callee || !names.has(callee)) return void 0;

  return [...call.arguments]
    .reverse()
    .find(
      (argument): argument is TestCallback =>
        ts.isArrowFunction(argument) || ts.isFunctionExpression(argument),
    );
}

function testCallback(call: ts.CallExpression, scope: string): TestCall | undefined {
  const callback = callbackFromCall(call, TEST_CALLBACKS);
  return callback ? { callback, call, scope } : void 0;
}

function collectTestCalls(source: ts.SourceFile): TestCall[] {
  const tests: TestCall[] = [];
  const visit = (node: ts.Node, scope = "file"): void => {
    if (ts.isCallExpression(node)) {
      const suite = callbackFromCall(node, SUITE_CALLBACKS);
      if (suite) {
        visit(suite.body, `suite:${node.getStart(source)}`);
        return;
      }

      const test = testCallback(node, scope);
      if (test) tests.push(test);
    }
    ts.forEachChild(node, (child) => visit(child, scope));
  };
  visit(source);
  return tests;
}

function isAssertionCall(node: ts.CallExpression): boolean {
  if (matcherCall(node)) return true;
  if (ts.isIdentifier(node.expression)) return node.expression.text === "assert";
  if (!ts.isPropertyAccessExpression(node.expression)) return false;
  return (
    ts.isIdentifier(node.expression.expression) &&
    ASSERTION_NAMESPACES.has(node.expression.expression.text)
  );
}

function containsAssertion(callback: TestCallback, assertionHelpers: ReadonlySet<string>): boolean {
  let assertion = false;
  const visit = (node: ts.Node): void => {
    if (assertion) return;
    if (ts.isCallExpression(node)) {
      const helper = ts.isIdentifier(node.expression)
        ? assertionHelpers.has(node.expression.text)
        : false;
      if (isAssertionCall(node) || helper) assertion = true;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(callback.body, visit);
  return assertion;
}

function collectAssertionHelpers(source: ts.SourceFile): Set<string> {
  const helpers = new Set<string>();

  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name && statement.body) {
      if (nodeContainsAssertion(statement.body)) helpers.add(statement.name.text);
      continue;
    }

    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
      const initializer = declaration.initializer;
      if (!ts.isArrowFunction(initializer) && !ts.isFunctionExpression(initializer)) {
        continue;
      }
      if (nodeContainsAssertion(initializer.body)) helpers.add(declaration.name.text);
    }
  }

  return helpers;
}

function nodeContainsAssertion(node: ts.Node): boolean {
  let assertion = false;
  const visit = (child: ts.Node): void => {
    if (assertion) return;
    if (ts.isCallExpression(child) && isAssertionCall(child)) assertion = true;
    ts.forEachChild(child, visit);
  };
  visit(node);
  return assertion;
}

function literalKey(expression: ts.Expression): string | undefined {
  if (ts.isParenthesizedExpression(expression)) return literalKey(expression.expression);
  if (expression.kind === ts.SyntaxKind.TrueKeyword) return "boolean:true";
  if (expression.kind === ts.SyntaxKind.FalseKeyword) return "boolean:false";
  if (expression.kind === ts.SyntaxKind.NullKeyword) return "null";
  if (ts.isStringLiteral(expression)) return `string:${expression.text}`;
  if (ts.isNumericLiteral(expression)) return `number:${expression.text}`;
  if (ts.isBigIntLiteral(expression)) return `bigint:${expression.text}`;
  if (ts.isIdentifier(expression) && expression.text === "undefined") return "undefined";
  return void 0;
}

function emptyValue(expression: ts.Expression): boolean {
  if (ts.isParenthesizedExpression(expression)) return emptyValue(expression.expression);
  if (ts.isStringLiteral(expression)) return expression.text.length === 0;
  if (ts.isNoSubstitutionTemplateLiteral(expression)) return expression.text.length === 0;
  if (ts.isArrayLiteralExpression(expression)) return expression.elements.length === 0;
  if (ts.isObjectLiteralExpression(expression)) return expression.properties.length === 0;
  return false;
}

function expectCall(expression: ts.Expression): ts.CallExpression | undefined {
  let current = expression;
  while (ts.isPropertyAccessExpression(current)) current = current.expression;
  if (!ts.isCallExpression(current)) return void 0;

  const base = baseCalleeName(current.expression);
  return base && EXPECTATION_CALLEES.has(base) ? current : void 0;
}

function matcherCall(node: ts.CallExpression):
  | {
      expect: ts.CallExpression;
      matcher: string;
    }
  | undefined {
  if (!ts.isPropertyAccessExpression(node.expression)) return void 0;
  const expect = expectCall(node.expression.expression);
  if (!expect) return void 0;
  return { expect, matcher: node.expression.name.text };
}

function isTautologicalAssertion(node: ts.CallExpression): boolean {
  const assertion = matcherCall(node);
  if (!assertion || !STATIC_MATCHERS.has(assertion.matcher)) return false;
  const actual = assertion.expect.arguments[0];
  if (!actual) return false;
  const actualKey = literalKey(actual);
  if (!actualKey) return false;

  if (assertion.matcher === "toBeTruthy") return actualKey === "boolean:true";
  if (assertion.matcher === "toBeFalsy") return actualKey === "boolean:false";
  if (assertion.matcher === "toBeDefined") return actualKey !== "undefined";
  if (assertion.matcher === "toBeUndefined") return actualKey === "undefined";
  if (assertion.matcher === "toBeNull") return actualKey === "null";

  const expected = node.arguments[0];
  return expected !== void 0 && literalKey(expected) === actualKey;
}

function isSchemaLiteralEchoAssertion(node: ts.CallExpression): boolean {
  const assertion = matcherCall(node);
  if (!assertion || !["toBe", "toEqual", "toStrictEqual"].includes(assertion.matcher)) {
    return false;
  }

  const actual = assertion.expect.arguments[0];
  const expected = node.arguments[0];
  if (!actual || !expected || !ts.isCallExpression(actual)) {
    return false;
  }

  const callee = actual.expression;
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== "parse") {
    return false;
  }

  const schema = callee.expression;
  const input = actual.arguments[0];
  if (!ts.isIdentifier(schema) || !/schema$/i.test(schema.text) || !input) {
    return false;
  }

  const inputKey = literalKey(input);
  return inputKey !== void 0 && literalKey(expected) === inputKey;
}

function isEmptySnapshotAssertion(node: ts.CallExpression): boolean {
  const assertion = matcherCall(node);
  if (!assertion || !SNAPSHOT_MATCHERS.has(assertion.matcher)) return false;
  const actual = assertion.expect.arguments[0];
  if (!actual || !emptyValue(actual)) return false;

  if (assertion.matcher === "toMatchSnapshot") return true;
  const snapshot = node.arguments[0];
  if (snapshot === void 0) return false;
  if (ts.isNoSubstitutionTemplateLiteral(snapshot)) {
    return ["", '""', "[]", "{}"].includes(snapshot.text);
  }
  return ts.isStringLiteral(snapshot) && ['""', "[]", "{}"].includes(snapshot.text);
}

function collectImportBindings(source: ts.SourceFile): ImportBinding[] {
  const bindings: ImportBinding[] = [];
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    const clause = statement.importClause;
    if (!clause || clause.isTypeOnly) continue;
    const module = statement.moduleSpecifier.text;
    if (clause.name) bindings.push({ name: clause.name.text, module });
    const named = clause.namedBindings;
    if (named && ts.isNamespaceImport(named)) bindings.push({ name: named.name.text, module });
    if (named && ts.isNamedImports(named)) {
      for (const element of named.elements) {
        if (!element.isTypeOnly) bindings.push({ name: element.name.text, module });
      }
    }
  }
  return bindings;
}

function isModuleMockCallee(callee: ts.Expression): boolean {
  if (!ts.isPropertyAccessExpression(callee)) return false;
  if (!ts.isIdentifier(callee.expression)) return false;

  const mockNamespace = ["vi", "jest", "mock"].includes(callee.expression.text);
  return mockNamespace && callee.name.text === "mock";
}

function collectMockedModules(source: ts.SourceFile): Set<string> {
  const modules = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (!ts.isCallExpression(node) || node.arguments.length === 0) {
      ts.forEachChild(node, visit);
      return;
    }
    const callee = node.expression;
    const isMock = isModuleMockCallee(callee);
    const module = node.arguments[0];
    if (isMock && module !== void 0 && ts.isStringLiteral(module)) {
      modules.add(module.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return modules;
}

function callbackUsesName(callback: TestCallback, name: string): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isIdentifier(node) && node.text === name) found = true;
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(callback.body, visit);
  return found;
}

function testSubjectStem(file: string): string {
  return basename(file)
    .replace(/\.(?:test|spec)\.[cm]?[jt]sx?$/, "")
    .replace(/\.(?:unit|integration|e2e)$/, "");
}

function moduleStem(module: string): string {
  return basename(module).replace(/\.[cm]?[jt]sx?$/, "");
}

function canonicalTestBody(source: ts.SourceFile, callback: TestCallback): string {
  const printer = ts.createPrinter({ removeComments: true });
  return printer
    .printNode(ts.EmitHint.Unspecified, callback.body, source)
    .replaceAll(/\s+/g, " ")
    .trim();
}

function lintTestFile(file: string): ArchitectureViolation[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const violations: ArchitectureViolation[] = [];
  const imports = collectImportBindings(source);
  const mockedModules = collectMockedModules(source);
  const assertionHelpers = collectAssertionHelpers(source);
  const duplicateBodies = new Map<string, TestCall>();

  for (const test of collectTestCalls(source)) {
    if (!containsAssertion(test.callback, assertionHelpers)) {
      violations.push({
        policy: "test-quality",
        file,
        line: lineOf(source, test.call),
        message: "Test callback has no recognised assertion.",
        allowed: "Assert an observable behaviour, or use an explicit assertion helper.",
      });
    }

    const bodyKey = `${test.scope}:${canonicalTestBody(source, test.callback)}`;
    const duplicate = duplicateBodies.get(bodyKey);
    if (duplicate) {
      violations.push({
        policy: "test-quality",
        file,
        line: lineOf(source, test.call),
        message: `Test body exactly duplicates the test at line ${lineOf(source, duplicate.call)}.`,
        allowed: "Keep one behaviour test, or make the distinct behaviour observable.",
      });
    } else {
      duplicateBodies.set(bodyKey, test);
    }

    for (const binding of imports) {
      const isSubject = moduleStem(binding.module) === testSubjectStem(file);
      if (!isSubject || !mockedModules.has(binding.module)) continue;
      if (!callbackUsesName(test.callback, binding.name)) continue;
      violations.push({
        policy: "test-quality",
        file,
        line: lineOf(source, test.call),
        message: `Test uses ${JSON.stringify(binding.name)} from its mocked subject module ${JSON.stringify(binding.module)}.`,
        allowed: "Mock collaborators, not the behaviour under test.",
      });
      break;
    }
  }

  const visit = (node: ts.Node): void => {
    if (!ts.isCallExpression(node)) {
      ts.forEachChild(node, visit);
      return;
    }
    if (isTautologicalAssertion(node)) {
      violations.push({
        policy: "test-quality",
        file,
        line: lineOf(source, node),
        message: "Assertion compares a static literal with the same known result.",
        allowed: "Assert a value derived from the behaviour under test.",
      });
    }
    if (isSchemaLiteralEchoAssertion(node)) {
      violations.push({
        policy: "test-quality",
        file,
        line: lineOf(source, node),
        message: "Assertion only echoes a static literal through a schema parser.",
        allowed: "Assert a refinement, default, transform, error, or observable caller behaviour.",
      });
    }
    if (isEmptySnapshotAssertion(node)) {
      violations.push({
        policy: "test-quality",
        file,
        line: lineOf(source, node),
        message: "Snapshot only records a statically empty value.",
        allowed: "Assert behaviour derived from the unit under test instead.",
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return violations;
}

export function lintTestQuality(
  root: string,
  options: TestQualityLintOptions = {},
): ArchitectureViolation[] {
  const files = options.files ?? [];
  return files
    .map((file) => resolve(root, file))
    .filter((file) => isTestFile(file) && existsSync(file))
    .flatMap(lintTestFile);
}
