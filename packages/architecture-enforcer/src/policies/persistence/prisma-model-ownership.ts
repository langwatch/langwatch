import { join, relative } from "node:path";

import ts from "typescript";

import type { ArchitectureViolation, FeatureCatalogueEntry } from "../../types.ts";
import { listFiles } from "../../workspace/layout.ts";
import { sourceFile, sourceText } from "../../workspace/module-graph.ts";
import type { WorkspaceSnapshot } from "../../workspace/snapshot.ts";
import {
  featureClaims,
  prismaModelNames,
  SHARED_PRISMA_TABLES,
  type SharedPrismaTable,
} from "./prisma-table-ownership.ts";

/**
 * ARCHITECTURE.md §17, rule 13a: each Prisma model has one owning module, derived from the tree,
 * and only it reaches the delegate. Shrink-only: tests/baselines/prisma-model-ownership.json.
 * A shared reader (SHARED_PRISMA_TABLES, R40) is left to prisma-table-ownership.
 */

const POLICY = "prisma-model-ownership";
const TEST_FILE = /(?:__tests__|__fixtures__|\/fixtures\/|\.(?:test|spec)\.)/;
const SOURCE_FILE = /\.[cm]?tsx?$/;
/** The model delegate methods a generated `PrismaClient` carries. */
const DELEGATE_METHODS = new Set([
  "aggregate",
  "count",
  "create",
  "createMany",
  "createManyAndReturn",
  "delete",
  "deleteMany",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "findUnique",
  "findUniqueOrThrow",
  "groupBy",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "upsert",
]);
/**
 * The names a Prisma client or transaction travels under. A delegate call is only read off one of
 * these, so `this.repositories.project.findMany(...)` on a port is never mistaken for a table.
 */
const CLIENT_NAME = /^#?(?:prisma|database|db|tx|transaction|trx|client)$/i;
/** A cheap text test before a parse: a client-named receiver's member call, or a delegate type. */
const MAY_REACH =
  /#?\b(?:prisma|database|db|tx|transaction|trx|client)\s*\.\s*[a-z]\w*\s*\.|PrismaClient|Delegate</i;
const ALLOWED =
  "Ask the owning module through its *Api, or move the code into the owner. A model's owner is the module whose repository claims it with PrismaRepository.for(...). See dev/docs/ARCHITECTURE.md §17.";

export type ModelOwnerSource = "claim" | "name" | "sole-user";
export type ModelOwner = { owner: string; source: ModelOwnerSource };
/** One reach of a model's delegate by a module, in one of the forms the policy reads. */
export type ModelAccess = {
  module: string;
  file: string;
  line: number;
  model: string;
  form: "call" | "client-index" | "client-pick" | "delegate-type" | "claim";
};

function delegateOf(model: string): string {
  return `${model.charAt(0).toLowerCase()}${model.slice(1)}`;
}

function kebab(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
}

function lineOf(source: ts.SourceFile, node: ts.Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

function lastName(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPrivateIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  if (expression.kind === ts.SyntaxKind.ThisKeyword) return "this";

  return void 0;
}

function typeName(node: ts.TypeNode): string | undefined {
  if (!ts.isTypeReferenceNode(node)) return void 0;

  const name = node.typeName;

  return ts.isIdentifier(name) ? name.text : name.right.text;
}

function literalTexts(node: ts.TypeNode | undefined): string[] {
  if (!node) return [];
  if (ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal)) return [node.literal.text];
  if (ts.isUnionTypeNode(node)) return node.types.flatMap(literalTexts);

  return [];
}

/** `R.<delegate>.<method>(...)` with R a Prisma client or transaction. */
function callDelegate(node: ts.Node): string | undefined {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return void 0;

  const method = node.expression;
  if (!DELEGATE_METHODS.has(method.name.text)) return void 0;
  if (!ts.isPropertyAccessExpression(method.expression)) return void 0;

  const delegate = method.expression;
  const client = lastName(delegate.expression);

  return client && CLIENT_NAME.test(client) ? delegate.name.text : void 0;
}

/** The delegates a type names: `PrismaClient["d"]`, `Pick<PrismaClient, "d">`, `Delegate<"d">`. */
function typeDelegates(node: ts.Node): { delegates: string[]; form: ModelAccess["form"] } {
  if (ts.isIndexedAccessTypeNode(node) && typeName(node.objectType) === "PrismaClient")
    return { delegates: literalTexts(node.indexType), form: "client-index" };

  if (!ts.isTypeReferenceNode(node)) return { delegates: [], form: "call" };

  const [first, second] = node.typeArguments ?? [];
  const name = typeName(node);

  if (name === "Pick" && first && typeName(first) === "PrismaClient")
    return { delegates: literalTexts(second), form: "client-pick" };

  if (name === "Delegate") return { delegates: literalTexts(first), form: "delegate-type" };

  return { delegates: [], form: "call" };
}

function fileAccesses({
  file,
  module,
  models,
}: {
  file: string;
  module: string;
  models: ReadonlyMap<string, string>;
}): ModelAccess[] {
  const source = sourceFile({ file });
  const found: ModelAccess[] = [];
  const add = (node: ts.Node, delegate: string, form: ModelAccess["form"]): void => {
    const model = models.get(delegate);
    if (model) found.push({ module, file, line: lineOf(source, node), model, form });
  };
  const visit = (node: ts.Node): void => {
    const called = callDelegate(node);
    if (called) add(node, called, "call");

    const typed = typeDelegates(node);
    for (const delegate of typed.delegates) add(node, delegate, typed.form);

    ts.forEachChild(node, visit);
  };
  visit(source);

  return found;
}

/** Every reach of a model's delegate from module source, claims included. */
export function collectPrismaModelAccess({
  root,
  catalogue,
}: {
  root: string;
  catalogue: readonly FeatureCatalogueEntry[];
}): ModelAccess[] {
  const models = new Map(
    [...prismaModelNames({ root, policy: POLICY }).keys()].map((model) => [
      delegateOf(model),
      model,
    ]),
  );

  return catalogue.flatMap((feature) => {
    const files = listFiles({
      directory: join(root, feature.root),
      accept: (file) => SOURCE_FILE.test(file) && !TEST_FILE.test(file),
    });
    const reached = [...files]
      .toSorted()
      .filter((file) => MAY_REACH.test(sourceText({ file })))
      .flatMap((file) => fileAccesses({ file, module: feature.id, models }));
    const claimed = featureClaims(root, feature, []).map((claim): ModelAccess => ({
      ...claim,
      module: claim.feature,
      form: "claim",
    }));

    return [...reached, ...claimed];
  });
}

type Span = { module: string; from: number; to: number };

/** Where a module id or subject's hyphen segments run, whole, inside the model's kebab name. */
function spansOf({ segments, word, module }: { segments: string[]; word: string; module: string }) {
  const parts = word.split("-");

  return segments.flatMap((_, from): Span[] => {
    const run = segments.slice(from, from + parts.length).join("-");

    return run === word ? [{ module, from, to: from + parts.length }] : [];
  });
}

/**
 * The one module the model's name spells. Every id or subject running whole inside the name
 * counts, a run inside a longer one aside, so SimulationSuite names scenario and suite and
 * settles nothing, while InstantEvalJudge names only instant-eval-judge.
 */
function nameOwner({
  model,
  catalogue,
}: {
  model: string;
  catalogue: readonly FeatureCatalogueEntry[];
}): string | undefined {
  const segments = kebab(model).split("-");
  const spans = catalogue.flatMap((feature) =>
    [feature.id, ...feature.subjects].flatMap((word) =>
      spansOf({ segments, word, module: feature.id }),
    ),
  );
  const outer = spans.filter(
    (span) =>
      !spans.some(
        (other) =>
          other.from <= span.from &&
          other.to >= span.to &&
          other.to - other.from > span.to - span.from,
      ),
  );
  const owners = new Set(outer.map((span) => span.module));

  return owners.size === 1 ? [...owners][0] : void 0;
}

/**
 * Each model's owner, in order: its `PrismaRepository.for`/`prismaTables` claim, the module its
 * name spells when that module reaches it, else its sole reacher. Never a guess: an unsettled
 * model goes in `undetermined` with the modules that reach it.
 */
export function prismaModelOwners({
  root,
  catalogue,
  accesses,
}: {
  root: string;
  catalogue: readonly FeatureCatalogueEntry[];
  accesses: readonly ModelAccess[];
}): { owners: Map<string, ModelOwner>; undetermined: Map<string, string[]> } {
  const owners = new Map<string, ModelOwner>();
  const undetermined = new Map<string, string[]>();

  for (const model of prismaModelNames({ root, policy: POLICY }).keys()) {
    const claim = accesses.find((access) => access.form === "claim" && access.model === model);
    const named = nameOwner({ model, catalogue });
    const users = [
      ...new Set(accesses.filter((access) => access.model === model).map((a) => a.module)),
    ].toSorted();

    // A name is evidence only where its module reaches the model: RoleBinding spells role, but
    // only authz and its peers reach it, so the name would guess, and so would the one reacher.
    const nameHolds = named !== undefined && users.includes(named);

    if (claim) owners.set(model, { owner: claim.module, source: "claim" });
    else if (nameHolds) owners.set(model, { owner: named, source: "name" });
    else if (named !== undefined && users.length > 0) undetermined.set(model, users);
    else if (users.length === 1 && users[0])
      owners.set(model, { owner: users[0], source: "sole-user" });
    else if (users.length > 1) undetermined.set(model, users);
  }

  return { owners, undetermined };
}

function isSharedReader({
  access,
  owner,
  shared,
}: {
  access: ModelAccess;
  owner: string;
  shared: readonly SharedPrismaTable[];
}): boolean {
  return shared.some(
    (item) =>
      item.table === access.model && item.owner === owner && item.readers.includes(access.module),
  );
}

/** A reach of a model by a module other than its derived owner, the owner's named readers aside. */
export function prismaModelOwnershipFindings({
  root,
  catalogue,
  shared = SHARED_PRISMA_TABLES,
}: {
  root: string;
  catalogue: readonly FeatureCatalogueEntry[];
  shared?: readonly SharedPrismaTable[];
}): (ModelAccess & ModelOwner)[] {
  const accesses = collectPrismaModelAccess({ root, catalogue });
  const { owners } = prismaModelOwners({ root, catalogue, accesses });

  return accesses.flatMap((access) => {
    const owner = owners.get(access.model);
    if (!owner || owner.owner === access.module) return [];

    return isSharedReader({ access, owner: owner.owner, shared }) ? [] : [{ ...access, ...owner }];
  });
}

/** The shrink-only list's key: `<file>|<model>`, repository-relative. */
export function prismaModelOwnershipKey({
  root,
  access,
}: {
  root: string;
  access: Pick<ModelAccess, "file" | "model">;
}): string {
  return `${relative(root, access.file)}|${access.model}`;
}

export function lintPrismaModelOwnership(
  snapshot: Pick<WorkspaceSnapshot, "root" | "catalogue">,
): ArchitectureViolation[] {
  return prismaModelOwnershipFindings({
    root: snapshot.root,
    catalogue: snapshot.catalogue,
  }).map((finding) => ({
    policy: POLICY,
    file: finding.file,
    line: finding.line,
    message: `${finding.module} reaches Prisma model ${finding.model}, which ${finding.owner} owns (owner derived from its ${finding.source}). Only the owner touches its delegate.`,
    allowed: ALLOWED,
  }));
}
