import { existsSync } from "node:fs";
import { join, relative } from "node:path";

import ts from "typescript";

import type { ArchitectureViolation } from "../../types.ts";
import { listFiles } from "../../workspace/layout.ts";
import { sourceFile, sourceText } from "../../workspace/module-graph.ts";
import type { WorkspaceSnapshot } from "../../workspace/snapshot.ts";

/**
 * One declaring class per handled error code (ARCHITECTURE.md §17, rule 13c): with two, a caller
 * comparing `error.code` cannot tell which failure it caught. Shrink-only. A class declares a code
 * by `declare readonly code: "<code>"` (each union member) or as `super(...)`'s first argument.
 */

const POLICY = "error-code-single-owner";
const SCAN_ROOTS = ["apps", "enterprise", "modules", "packages"];
const GENERATED_CODES = "packages/handled-error/src/codes.generated.ts";
const GENERATED_TABLES = new Set(["goErrorCodes", "nodeErrorCodes"]);
const TEST_FILE = /(?:__tests__|__fixtures__|\/fixtures\/|\.(?:test|spec)\.)/;
const SOURCE_FILE = /\.[cm]?tsx?$/;
const ERROR_CODE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
const MENTIONS_CODE = /\bsuper\(\s*["']|declare\s+readonly\s+code\b/;
/** A built-in's first argument is a message, never a code. */
const BUILT_IN_ERRORS = new Set(["Error", "TypeError", "RangeError", "SyntaxError"]);

/**
 * Codes several classes declare on purpose, each with the kind of failure it names: the HTTP
 * status a boundary answers rather than one failure, and the caller acts on the kind. Read from
 * the tree on 2026-10-20 (every status-shaped code more than one class declares), not chosen.
 */
const GENERIC_ERROR_CODE_KINDS = {
  bad_request: "the 400 kind, a request the boundary could not read",
  forbidden: "a 403 kind a guard answers",
  insufficient_permissions: "a 403 kind a guard answers",
  internal_error: "the 500 kind, a platform fault with nothing the caller can do",
  malformed_request: "the 400 kind, a request the boundary could not read",
  not_found: "the 404 kind NotFoundError carries when no specific code fits",
  payload_too_large: "the 413 kind the REST door and the Go RPC layer both answer",
  permission_denied: "a 403 kind a guard answers",
  rate_limited: "the 429 kind",
  service_unavailable: 'the 503 kind isTransientRefusal reads as "retry" (22 classes, 19 modules)',
  unauthorized: "the 401 kind, no session or key (nine classes in eight modules)",
  validation_error: "ValidationError's rejected-input kind behind meta.fieldErrors",
} as const satisfies Record<string, string>;

export const GENERIC_ERROR_CODES: ReadonlySet<string> = new Set(
  Object.keys(GENERIC_ERROR_CODE_KINDS),
);

/** One class, or one generated service table, declaring a code. */
export type CodeDeclaration = { code: string; declarer: string; file: string; line: number };

function lineOf(source: ts.SourceFile, node: ts.Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

function heritageName(node: ts.ClassLikeDeclaration): string | undefined {
  const clause = node.heritageClauses?.find((item) => item.token === ts.SyntaxKind.ExtendsKeyword);
  const expression = clause?.types[0]?.expression;
  if (!expression) return void 0;

  if (ts.isIdentifier(expression)) return expression.text;

  return ts.isPropertyAccessExpression(expression) ? expression.name.text : void 0;
}

function literalCodes(node: ts.TypeNode | undefined): string[] {
  if (!node) return [];
  if (ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal)) return [node.literal.text];

  return ts.isUnionTypeNode(node) ? node.types.flatMap(literalCodes) : [];
}

function declaredCodes(member: ts.ClassElement): string[] {
  if (!ts.isPropertyDeclaration(member) || !ts.isIdentifier(member.name)) return [];
  if (member.name.text !== "code") return [];

  const declared = (ts.getModifiers(member) ?? []).some(
    (item) => item.kind === ts.SyntaxKind.DeclareKeyword,
  );

  return declared ? literalCodes(member.type) : [];
}

function superCodes(member: ts.ClassElement): string[] {
  if (!ts.isConstructorDeclaration(member) || !member.body) return [];

  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionLike(node) || ts.isClassLike(node)) return;

    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.SuperKeyword) {
      const first = node.arguments[0];
      if (first && ts.isStringLiteralLike(first)) found.push(first.text);
    }

    ts.forEachChild(node, visit);
  };
  ts.forEachChild(member.body, visit);

  return found;
}

function classDeclarations({
  source,
  file,
}: {
  source: ts.SourceFile;
  file: string;
}): CodeDeclaration[] {
  const found: CodeDeclaration[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isClassLike(node) && node.name) {
      const parent = heritageName(node);
      const fromSuper =
        parent && !BUILT_IN_ERRORS.has(parent) ? node.members.flatMap(superCodes) : [];
      const codes = new Set([...node.members.flatMap(declaredCodes), ...fromSuper]);

      for (const code of [...codes].filter((item) => ERROR_CODE.test(item))) {
        found.push({ code, declarer: node.name.text, file, line: lineOf(source, node) });
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(source);

  return found;
}

function unwrap(node: ts.Expression | undefined): ts.Expression | undefined {
  if (node && (ts.isAsExpression(node) || ts.isSatisfiesExpression(node)))
    return unwrap(node.expression);

  return node;
}

function generatedDeclarations(file: string): CodeDeclaration[] {
  const source = sourceFile({ file });

  return source.statements.filter(ts.isVariableStatement).flatMap((statement) =>
    statement.declarationList.declarations.flatMap((declaration): CodeDeclaration[] => {
      const name = ts.isIdentifier(declaration.name) ? declaration.name.text : "";
      const table = unwrap(declaration.initializer);
      if (!GENERATED_TABLES.has(name) || !table || !ts.isObjectLiteralExpression(table)) return [];

      return table.properties.filter(ts.isPropertyAssignment).flatMap((property) => {
        const code = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name);
        const service = /service:\s*"([^"]+)"/.exec(property.initializer.getText(source))?.[1];
        if (!code || !service) return [];

        const declarer = `${name}.${service}`;

        return [{ code: property.name.text, declarer, file, line: lineOf(source, property) }];
      });
    }),
  );
}

/** Every declaration of a handled error code in the tree, one per declaring class and code. */
export function collectErrorCodeDeclarations({ root }: { root: string }): CodeDeclaration[] {
  const generated = join(root, GENERATED_CODES);
  const classes = SCAN_ROOTS.filter((directory) => existsSync(join(root, directory))).flatMap(
    (directory) =>
      listFiles({
        directory: join(root, directory),
        accept: (file) => SOURCE_FILE.test(file) && !TEST_FILE.test(file) && file !== generated,
      })
        .filter((file) => MENTIONS_CODE.test(sourceText({ file })))
        .toSorted()
        .flatMap((file) => classDeclarations({ source: sourceFile({ file }), file })),
  );

  return [...classes, ...(existsSync(generated) ? generatedDeclarations(generated) : [])];
}

/** Each non-generic code two or more classes declare, with every declaration. */
export function sharedErrorCodes({ root }: { root: string }): Map<string, CodeDeclaration[]> {
  const byCode = new Map<string, CodeDeclaration[]>();

  for (const declaration of collectErrorCodeDeclarations({ root })) {
    if (GENERIC_ERROR_CODES.has(declaration.code)) continue;

    byCode.set(declaration.code, [...(byCode.get(declaration.code) ?? []), declaration]);
  }

  return new Map([...byCode].filter(([, declarations]) => declarations.length > 1));
}

/** The shrink-only list's keys: one per declaring class, keyed by code. */
export function errorCodeSingleOwnerKeys({ root }: { root: string }): string[] {
  return [...sharedErrorCodes({ root })].flatMap(([code, declarations]) =>
    declarations.map(() => code),
  );
}

export function lintErrorCodeSingleOwner(snapshot: WorkspaceSnapshot): ArchitectureViolation[] {
  const { root } = snapshot;

  return [...sharedErrorCodes({ root })].flatMap(([code, declarations]) =>
    declarations.map((declaration) => ({
      policy: POLICY,
      file: declaration.file,
      line: declaration.line,
      message: `Error code ${code} is declared by ${declarations.length} classes: ${declarations
        .map((item) => `${item.declarer} (${relative(root, item.file)})`)
        .join(", ")}. A code has one declaring class.`,
      allowed:
        "Keep one class as the code's owner and have the others throw it, or give each failure its own code with its own presentation entry. See dev/docs/best_practices/error-handling.md and dev/docs/ARCHITECTURE.md §17.",
    })),
  );
}
