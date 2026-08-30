import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import ts from "typescript";
import type { ArchitectureViolation } from "./types";

const TEST_FILE = /(?:^|\/)\S+\.(?:test|spec)\.[cm]?[jt]sx?$/;
const TEST_CALLBACKS = new Set(["it", "test"]);
const SUITE_CALLBACKS = new Set(["describe", "suite"]);
const EXPECTATION_CALLEES = new Set(["expect", "expectTypeOf"]);
const ASSERTION_NAMESPACES = new Set(["assert", "chai"]);
/**
 * `expect.<name>()` forms that ARE an assertion on their own.
 *
 * Deliberately not every static on `expect`: `expect.any`,
 * `expect.objectContaining` and friends are matcher ARGUMENTS, and counting
 * them would let a test satisfy this rule by constructing a matcher it never
 * asserts against. These four either fail the test outright or state how many
 * assertions must have run.
 */
const EXPECT_STATIC_ASSERTIONS = new Set(["assertions", "fail", "hasAssertions", "unreachable"]);
/**
 * An IMPORTED binding named this way is taken to assert.
 *
 * Only imported ones. A helper declared in the file is judged by its body,
 * which is stricter and costs nothing; a helper from another module has no body
 * to read without cross-file analysis, so the name is the whole signal —
 * `~/test-utils/expectCanonicalError` is the case, and eight REST tests calling
 * it read as empty. The repo already treats `expectX`/`assertX` as the name an
 * assertion helper carries, so this reads a convention rather than inventing
 * one.
 */
const IMPORTED_ASSERTION_HELPER = /^(?:expect|assert)[A-Z]/;
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
  if (!ts.isIdentifier(node.expression.expression)) return false;
  const namespace = node.expression.expression.text;
  if (ASSERTION_NAMESPACES.has(namespace)) return true;
  // `expect.fail(...)` in a catch branch is how a test says "reaching here is
  // the failure". It asserts as surely as a matcher does, and reading it as
  // absent reported two real memory-budget tests as empty.
  return (
    EXPECTATION_CALLEES.has(namespace) && EXPECT_STATIC_ASSERTIONS.has(node.expression.name.text)
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

/**
 * A function TypeScript itself calls an assertion: `asserts x is T`, or the
 * bare `asserts x`. Such a helper narrows by THROWING rather than by calling a
 * matcher, so its body holds no `expect` for `nodeContainsAssertion` to find —
 * `assertExceeded` in the usage service tests is exactly that, and every test
 * calling it read as empty.
 */
function assertsType(node: ts.SignatureDeclaration): boolean {
  return (
    node.type !== void 0 &&
    ts.isTypePredicateNode(node.type) &&
    node.type.assertsModifier !== void 0
  );
}

/**
 * Every assertion helper in the file, at any depth.
 *
 * This used to read `source.statements` alone, so it saw only helpers declared
 * at the top level — and the idiomatic place for one is INSIDE its `describe`,
 * where it can close over the store, projection or app the suite built.
 * `assertCorrectFinalState`, `expectCanonicalError` and `assertExceeded` are all
 * written that way, and twelve tests calling them were reported as having no
 * assertion at all.
 *
 * Collecting by name across the whole file is slightly generous — two helpers
 * of the same name in sibling scopes are one entry — but a name collision
 * between two assertion helpers costs nothing here, while missing a scope costs
 * a false report on every test that uses it.
 */
function collectAssertionHelpers(source: ts.SourceFile): Set<string> {
  const helpers = new Set<string>();

  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      if (assertsType(node) || nodeContainsAssertion(node.body)) helpers.add(node.name.text);
    } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const initializer = node.initializer;
      if (
        initializer &&
        (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) &&
        (assertsType(initializer) || nodeContainsAssertion(initializer.body))
      ) {
        helpers.add(node.name.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);

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
  for (const binding of imports) {
    if (IMPORTED_ASSERTION_HELPER.test(binding.name)) assertionHelpers.add(binding.name);
  }
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
