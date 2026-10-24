import { join, relative, sep } from "node:path";

import ts from "typescript";

import type { ArchitectureViolation } from "../../types.ts";
import { sourceFile, sourceText } from "../../workspace/module-graph.ts";
import type { WorkspaceSnapshot } from "../../workspace/snapshot.ts";

/**
 * Rule 8 of dev/docs/plans/platform-architecture-blocks.md: customer words live in the client
 * presentation registry keyed by code, not in a `{ code, message }` failure's message. Biased to
 * false negatives. Shrink-only baseline in tests/baselines, never read by this policy.
 */

export const HANDLED_ERROR_SENTENCE_COPY_POLICY = "handled-error-sentence-copy";
export const HANDLED_ERROR_SENTENCE_COPY_RATCHET =
  "packages/architecture-enforcer/tests/baselines/handled-error-sentence-copy.json";

const MODULE_TREES = ["modules", "enterprise/modules"] as const;
const GOVERNED = /^(?:enterprise\/)?modules\/[^/]+\/(?:contract|process)\/src\//;
const SOURCE_FILE = /\.[cm]?tsx?$/;
const NOT_PRODUCTION =
  /(?:^|\/)(?:__tests__|__fixtures__|__mocks__|fixtures|e2e|generated)\/|\.(?:test|spec|stories|fixture|generated)\.[cm]?[jt]sx?$/;
/** In-memory stand-ins for a vendor's API mimic that vendor's text, so they are left alone. */
const VENDOR_STAND_IN = /\/channels\/memory\//;
/**
 * A capitalised word and one more word. A slug (`thing_not_found`), a template opening on a
 * substitution and a message read from a variable are not sentence copy.
 */
const SENTENCE = /^[A-Z][a-z']*,?\s+[A-Za-z"'`(]/;

type Finding = { file: string; line: number };

function workspacePath({ root, file }: { root: string; file: string }): string {
  return relative(root, file).split(sep).join("/");
}

function propertyName(node: ts.ObjectLiteralElementLike): string | undefined {
  const name = node.name;
  if (!name) return undefined;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;

  return undefined;
}

function property({
  object,
  name,
}: {
  object: ts.ObjectLiteralExpression;
  name: string;
}): ts.ObjectLiteralElementLike | undefined {
  return object.properties.find((element) => propertyName(element) === name);
}

/** The text a message opens with, when it is written in place. */
function leadingText(node: ts.Expression): string | undefined {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) return node.head.text;

  return undefined;
}

export function isSentenceCopy(text: string): boolean {
  return SENTENCE.test(text);
}

/** A zod issue: its code is zod's `custom`, or the object is handed to `addIssue`. */
function isZodIssue({
  object,
  code,
}: {
  object: ts.ObjectLiteralExpression;
  code: ts.ObjectLiteralElementLike;
}): boolean {
  const value = ts.isPropertyAssignment(code) ? code.initializer : undefined;
  if (value && ts.isStringLiteral(value) && value.text === "custom") return true;
  if (value && ts.isPropertyAccessExpression(value) && value.name.text === "custom") return true;
  const parent = object.parent;

  return (
    ts.isCallExpression(parent) &&
    ts.isPropertyAccessExpression(parent.expression) &&
    parent.expression.name.text === "addIssue"
  );
}

/** The `message` of a `{ code, message }` failure, when it is written as sentence copy. */
function sentenceCopyMessage(
  object: ts.ObjectLiteralExpression,
): ts.PropertyAssignment | undefined {
  const code = property({ object, name: "code" });
  const message = property({ object, name: "message" });
  if (!code || !message || !ts.isPropertyAssignment(message)) return undefined;

  const opening = leadingText(message.initializer);
  if (opening === undefined || !isSentenceCopy(opening)) return undefined;
  if (isZodIssue({ object, code })) return undefined;

  return message;
}

function fileFindings({ file, path }: { file: string; path: string }): Finding[] {
  const text = sourceText({ file });
  if (!/\bmessage\b/.test(text) || !/\bcode\b/.test(text)) return [];

  const source = sourceFile({ file });
  const found: Finding[] = [];
  const visit = (node: ts.Node): void => {
    const message = ts.isObjectLiteralExpression(node) ? sentenceCopyMessage(node) : undefined;
    if (message) {
      found.push({
        file: path,
        line: source.getLineAndCharacterOfPosition(message.getStart(source)).line + 1,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  return found;
}

/**
 * Each `{ code, message }` failure in module contract or process code whose message is customer
 * sentence copy.
 */
export function collectHandledErrorSentenceCopy(snapshot: WorkspaceSnapshot): Finding[] {
  const { root } = snapshot;

  return MODULE_TREES.flatMap((directory) =>
    snapshot.files({
      directory: join(root, directory),
      accept: (file) => {
        const path = workspacePath({ root, file });

        return (
          SOURCE_FILE.test(path) &&
          GOVERNED.test(path) &&
          !NOT_PRODUCTION.test(path) &&
          !VENDOR_STAND_IN.test(path)
        );
      },
    }),
  ).flatMap((file) => fileFindings({ file, path: workspacePath({ root, file }) }));
}

/** The shrink-only key: the file. */
export function handledErrorSentenceCopyKey(finding: Finding): string {
  return finding.file;
}

export function lintHandledErrorSentenceCopy(snapshot: WorkspaceSnapshot): ArchitectureViolation[] {
  return collectHandledErrorSentenceCopy(snapshot).map((finding) => ({
    policy: HANDLED_ERROR_SENTENCE_COPY_POLICY,
    file: finding.file,
    line: finding.line,
    message:
      "This failure carries a code and writes its customer copy as the message: the words a customer reads are authored outside the presentation registry.",
    allowed: `Carry the code and the meta the copy needs, and write the words as that code's entry in packages/handled-error/src/presentation.ts. Each file's count in ${HANDLED_ERROR_SENTENCE_COPY_RATCHET} may fall, never rise.`,
  }));
}
