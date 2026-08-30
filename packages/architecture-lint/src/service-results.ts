import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { walkFiles } from "./files";
import type { ArchitectureViolation, ClassifiedPackage } from "./types";

function lineOf(source: ts.SourceFile, node: ts.Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

function promiseTypeArgument(node: ts.TypeNode): ts.TypeNode | undefined {
  if (!ts.isTypeReferenceNode(node) || !ts.isIdentifier(node.typeName)) return void 0;
  if (node.typeName.text !== "Promise" || node.typeArguments?.length !== 1) return void 0;
  return node.typeArguments[0];
}

function containsNullableType(node: ts.TypeNode): boolean {
  if (
    node.kind === ts.SyntaxKind.UndefinedKeyword ||
    (ts.isLiteralTypeNode(node) && node.literal.kind === ts.SyntaxKind.NullKeyword)
  ) {
    return true;
  }
  if (ts.isUnionTypeNode(node)) return node.types.some(containsNullableType);
  const promiseArgument = promiseTypeArgument(node);
  if (promiseArgument) return containsNullableType(promiseArgument);
  return false;
}

function definitelyNonNullableType(node: ts.TypeNode): boolean {
  if (ts.isParenthesizedTypeNode(node)) {
    return definitelyNonNullableType(node.type);
  }
  if (ts.isUnionTypeNode(node)) {
    return node.types.every(definitelyNonNullableType);
  }
  const promiseArgument = promiseTypeArgument(node);
  if (promiseArgument) return definitelyNonNullableType(promiseArgument);
  if (ts.isLiteralTypeNode(node)) {
    return node.literal.kind !== ts.SyntaxKind.NullKeyword;
  }
  const primitiveType = [
    ts.SyntaxKind.StringKeyword,
    ts.SyntaxKind.NumberKeyword,
    ts.SyntaxKind.BooleanKeyword,
    ts.SyntaxKind.BigIntKeyword,
    ts.SyntaxKind.SymbolKeyword,
    ts.SyntaxKind.ObjectKeyword,
    ts.SyntaxKind.VoidKeyword,
  ].includes(node.kind);
  const containerType = ts.isTypeLiteralNode(node) || ts.isArrayTypeNode(node);
  const callableType = ts.isTupleTypeNode(node) || ts.isFunctionTypeNode(node);
  const compositeType = containerType || callableType;
  return primitiveType || compositeType;
}

function isPublicNamedClassMethod(node: ts.Node): node is ts.MethodDeclaration {
  if (!ts.isMethodDeclaration(node)) return false;
  const isClassMember = ts.isClassDeclaration(node.parent) || ts.isClassExpression(node.parent);
  const hasName = node.name !== void 0 && ts.isIdentifier(node.name);
  const isPublic = !node.modifiers?.some(
    (modifier) => modifier.kind === ts.SyntaxKind.PrivateKeyword,
  );
  return isClassMember && hasName && isPublic;
}

function lintResultContract(file: string): ArchitectureViolation[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const violations: ArchitectureViolation[] = [];
  const visit = (node: ts.Node): void => {
    if (isPublicNamedClassMethod(node)) {
      const name = ts.isIdentifier(node.name) ? node.name.text : void 0;
      if (!name) return;
      // `requireById` — the imperative — is the redundant one: an ordinary
      // method already returns a value or throws. `requiredFieldsArePresent` is
      // an adjective, and `required` is one of the boolean prefixes
      // `require-boolean-name-prefix` explicitly allows, so it is not that.
      if (/^require[A-Z]/.test(name)) {
        violations.push({
          policy: "fallible-result-naming",
          file,
          line: lineOf(source, node),
          message: `Capability ${JSON.stringify(name)} uses the redundant require prefix.`,
          allowed:
            "Use an ordinary domain method that returns a value or throws. Prefix only optional absence-bearing methods with try.",
        });
      }
      if (!node.type) {
        violations.push({
          policy: "fallible-result-naming",
          file,
          line: lineOf(source, node),
          message: `Capability ${JSON.stringify(name)} has no explicit result type, so its absence contract cannot be enforced.`,
          allowed:
            "Declare the result type. Ordinary methods return a value or throw; only try* may explicitly return null or undefined.",
        });
      } else if (containsNullableType(node.type) && !name.startsWith("try")) {
        violations.push({
          policy: "fallible-result-naming",
          file,
          line: lineOf(source, node),
          message: `Capability ${JSON.stringify(name)} exposes absence without the try prefix.`,
          allowed:
            "Return a value or throw from the ordinary method. If callers genuinely need optional discovery, name that separately needed capability try* and return null or undefined.",
        });
      } else if (
        !containsNullableType(node.type) &&
        name.startsWith("try") &&
        definitelyNonNullableType(node.type)
      ) {
        violations.push({
          policy: "fallible-result-naming",
          file,
          line: lineOf(source, node),
          message: `Optional capability ${JSON.stringify(name)} cannot express absence.`,
          allowed:
            "Return null or undefined from try*, or remove the try prefix and throw on absence. Do not add paired methods preemptively.",
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return violations;
}

export function lintServiceResultContracts(
  packages: readonly ClassifiedPackage[],
): ArchitectureViolation[] {
  return packages.flatMap((pkg) => {
    if (pkg.layoutVersion !== 0 || (pkg.kind !== "contract" && pkg.kind !== "server")) {
      return [];
    }
    return walkFiles(join(pkg.root, "src"), (file) =>
      /\.(?:service|port|repository|store)\.ts$/.test(file),
    ).flatMap(lintResultContract);
  });
}
