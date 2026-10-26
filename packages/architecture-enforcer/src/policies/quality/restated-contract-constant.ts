import { join, relative, sep } from "node:path";

import ts from "typescript";

import type { ArchitectureViolation, ClassifiedPackage } from "../../types.ts";
import { mentionMatcher, sourceFile } from "../../workspace/module-graph.ts";
import type { WorkspaceSnapshot } from "../../workspace/snapshot.ts";

/**
 * Rule 16 of dev/docs/plans/platform-architecture-blocks.md: a contract's exported string constant
 * is the one place that string is spelled; a second spelling drifts. Shrink-only:
 * tests/baselines/restated-contract-constant.json holds today's count per file and string.
 */

export const RESTATED_CONTRACT_CONSTANT_POLICY = "restated-contract-constant";
export const RESTATED_CONTRACT_CONSTANT_RATCHET =
  "packages/architecture-enforcer/tests/baselines/restated-contract-constant.json";

const SCANNED_TREES = ["modules", "enterprise", "apps"] as const;
/**
 * Framework and library packages sit below every contract. A string one of them spells (an
 * attribute key span-normalisation names, say) is their vocabulary, and a contract exporting it
 * restates it rather than owning it, so the string is not indexed.
 */
const VOCABULARY_TREE = "packages";
const SOURCE_FILE = /\.[cm]?tsx?$/;
const TEST_FILE =
  /(?:__tests__|__fixtures__|__mocks__|\/fixtures\/|\/e2e\/|\/testing\/|\.(?:test|spec|stories|fixture|d)\.)/;
const GENERATED = /(?:^|\/)generated\/|\.generated\./;
/** Short or plain words ("trace", "a value") are vocabulary, not a contract's spelling. */
const MINIMUM_LENGTH = 10;
const STRUCTURED = /[._:-]/;
/** An event or projection version: events versioned the same day share a date, not a meaning. */
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** A media type is IANA's vocabulary; a contract naming one as a default does not own it. */
const MEDIA_TYPE = /^(?:application|audio|image|multipart|text|video)\/[\w.+-]+$/;

/**
 * Constants whose string the contract does not own, each with the reason. Keep this short: an
 * entry here hides every restatement of the string from the rule.
 */
const NOT_OWNED: ReadonlyMap<string, string> = new Map([
  [
    "AUTHZ_SHARE_PERMISSION",
    "aliases the permission traces:view, a member of authz's permission union that the compiler checks at every use",
  ],
  [
    "INSTANT_EVAL_REQUEST_TYPE",
    "instant_eval is also evaluation's own dispatch kind; the two agree in spelling, not in meaning",
  ],
  [
    "TRACE_TOOL_CALLS_PATH",
    "tool_calls is the chat message field every provider and transcript names, not scenario's spelling",
  ],
]);

/** A string constant a contract package exports. */
export type ContractConstant = { name: string; value: string; file: string; contract: string };

/** A literal outside the declaring contract that spells one of its exported constants. */
export type RestatedConstant = { file: string; line: number; constant: ContractConstant };

function workspacePath({ root, file }: { root: string; file: string }): string {
  return relative(root, file).split(sep).join("/");
}

function unwrap(expression: ts.Expression): ts.Expression {
  if (ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression))
    return unwrap(expression.expression);

  return ts.isParenthesizedExpression(expression) ? unwrap(expression.expression) : expression;
}

function stringOf(node: ts.Node): string | undefined {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : void 0;
}

function isExported(statement: ts.VariableStatement): boolean {
  return (ts.getModifiers(statement) ?? []).some(
    (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
  );
}

function isIndexed({
  value,
  moduleIds,
}: {
  value: string;
  moduleIds: ReadonlySet<string>;
}): boolean {
  if (value.length < MINIMUM_LENGTH || !STRUCTURED.test(value) || /\s/.test(value)) return false;

  // A module id is the catalogue's vocabulary, spelled by every module that names the module.
  return !DATE.test(value) && !MEDIA_TYPE.test(value) && !moduleIds.has(value);
}

/** Every `export const X = "..."` in a contract package's src, top level only. */
export function collectContractConstants(snapshot: WorkspaceSnapshot): ContractConstant[] {
  const { root } = snapshot;
  const contracts = snapshot.packages.filter(
    (pkg): pkg is ClassifiedPackage => pkg.kind === "contract",
  );
  const moduleIds = new Set(snapshot.catalogue.map((entry) => entry.id));
  const found: ContractConstant[] = [];

  for (const contract of contracts) {
    const contractRoot = workspacePath({ root, file: contract.root });
    const files = snapshot.files({
      directory: join(contract.root, "src"),
      accept: (file) => SOURCE_FILE.test(file) && !TEST_FILE.test(file) && !GENERATED.test(file),
    });

    for (const file of files) {
      const where = { file: workspacePath({ root, file }), contract: contractRoot };
      for (const declaration of exportedConstDeclarations(file)) {
        const constant = indexedConstant({ declaration, moduleIds });
        if (constant) found.push({ ...constant, ...where });
      }
    }
  }

  return found;
}

/** Every declaration in a file's top-level `export const` statements. */
function exportedConstDeclarations(file: string): ts.VariableDeclaration[] {
  return sourceFile({ file, parents: false })
    .statements.filter(ts.isVariableStatement)
    .filter(
      (statement) =>
        isExported(statement) && (statement.declarationList.flags & ts.NodeFlags.Const) !== 0,
    )
    .flatMap((statement) => [...statement.declarationList.declarations]);
}

/** The name and string value of a declaration the rule indexes, or undefined. */
function indexedConstant({
  declaration,
  moduleIds,
}: {
  declaration: ts.VariableDeclaration;
  moduleIds: ReadonlySet<string>;
}): { name: string; value: string } | undefined {
  if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) return void 0;
  const name = declaration.name.text;
  const value = stringOf(unwrap(declaration.initializer));
  if (value === undefined || NOT_OWNED.has(name)) return void 0;

  return isIndexed({ value, moduleIds }) ? { name, value } : void 0;
}

function lineOf({ source, node }: { source: ts.SourceFile; node: ts.Node }): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

function isInside({ path, directory }: { path: string; directory: string }): boolean {
  return path.startsWith(`${directory}/`);
}

/**
 * Every string literal, in non-test source outside the declaring contract package, equal to a
 * contract's exported constant. A value two contracts export is shared vocabulary, which no
 * contract owns, so it is not indexed.
 */
export function collectRestatedContractConstants(snapshot: WorkspaceSnapshot): RestatedConstant[] {
  const byValue = new Map<string, ContractConstant[]>();
  for (const constant of collectContractConstants(snapshot))
    byValue.set(constant.value, [...(byValue.get(constant.value) ?? []), constant]);

  const owned = new Map<string, ContractConstant>();
  for (const [value, constants] of byValue) {
    if (new Set(constants.map((constant) => constant.contract)).size === 1)
      owned.set(value, constants[0]!);
  }
  for (const literal of literalsIn({ snapshot, trees: [VOCABULARY_TREE], owned }))
    owned.delete(literal.constant.value);

  return literalsIn({ snapshot, trees: SCANNED_TREES, owned }).filter(
    (literal) => !isInside({ path: literal.file, directory: literal.constant.contract }),
  );
}

/** Every string literal in non-test source under `trees` equal to one of the `owned` values. */
function literalsIn({
  snapshot,
  trees,
  owned,
}: {
  snapshot: WorkspaceSnapshot;
  trees: readonly string[];
  owned: ReadonlyMap<string, ContractConstant>;
}): RestatedConstant[] {
  const { root } = snapshot;
  if (owned.size === 0) return [];

  const mayName = mentionMatcher({ words: owned.keys() });
  const found: RestatedConstant[] = [];

  for (const tree of trees) {
    const files = snapshot.files({
      directory: join(root, tree),
      accept: (file) => SOURCE_FILE.test(file) && !TEST_FILE.test(file) && !GENERATED.test(file),
    });

    for (const file of files) {
      if (mayName(file))
        found.push(...literalsInFile({ file, path: workspacePath({ root, file }), owned }));
    }
  }

  return found;
}

/** Every string literal in one file equal to one of the `owned` values. */
function literalsInFile({
  file,
  path,
  owned,
}: {
  file: string;
  path: string;
  owned: ReadonlyMap<string, ContractConstant>;
}): RestatedConstant[] {
  const source = sourceFile({ file, parents: false });
  const found: RestatedConstant[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    const text = stringOf(node);
    const constant = text === undefined ? undefined : owned.get(text);
    if (constant !== undefined)
      found.push({ file: path, line: lineOf({ source, node }), constant });
    ts.forEachChild(node, visit);
  };
  visit(source);

  return found;
}

/** The shrink-only list's key: the file and the string it restates. */
export function restatedConstantKey(finding: RestatedConstant): string {
  return `${finding.file}|${finding.constant.value}`;
}

export function lintRestatedContractConstants(
  snapshot: WorkspaceSnapshot,
): ArchitectureViolation[] {
  return collectRestatedContractConstants(snapshot).map((finding) => ({
    policy: RESTATED_CONTRACT_CONSTANT_POLICY,
    file: finding.file,
    line: finding.line,
    specifier: finding.constant.value,
    message: `"${finding.constant.value}" restates ${finding.constant.name}, which ${finding.constant.file} exports; this copy stops agreeing the day the contract changes it.`,
    allowed: `Import ${finding.constant.name} from its contract (${finding.constant.contract}) instead of spelling the string. Each count in ${RESTATED_CONTRACT_CONSTANT_RATCHET} may fall, never rise.`,
  }));
}
