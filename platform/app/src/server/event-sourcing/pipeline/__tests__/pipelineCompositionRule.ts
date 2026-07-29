/**
 * ADR-082 Rule 1, made mechanical.
 *
 * > **Rule 1 — nothing in `Deps` may be a value the builder registers.** Every
 * > argument to `.withFoldProjection`, `.withMapProjection`, `.withProjection`,
 * > `.withEventSubscriber`, `.withProcessManager`, `.withCommand` and
 * > `.withCommandInstance` is constructed in `pipeline.ts` from a symbol
 * > `pipeline.ts` imports. `deps.x` may appear *inside* those arguments; it may
 * > never *be* one.
 *
 * The rule lived only in prose, which is why it drifted: `trace-processing`'s
 * own docblock claimed compliance while six of its deps violated it. This
 * module reads every `pipelines/<x>/pipeline.ts` with the TypeScript parser and
 * reports the violations by name, so the ADR's Consequences section
 * ("the layer membership tests … should become lint rules or bound scenarios")
 * has something behind it.
 *
 * Why a parse rather than a runtime assertion on the built
 * `StaticPipelineDefinition`: once a pipeline is built, a projection that was
 * injected and a projection that was constructed in the factory are the same
 * object. The distinction Rule 1 draws exists only in the source, so the source
 * is what gets read. Why not a lint rule: the repo's biome gate reports
 * everything as a warning and counts per-(file, rule) increases, so a lint rule
 * would not fail a build, and it could not carry the shrink-only ratchet below.
 *
 * Two independent checks, because neither subsumes the other:
 *
 *   - `deps-type`  — a `Deps` member whose *type* is one of the definition
 *     types a registering method accepts. Catches a dep that is a registered
 *     value even when the pipeline mounts it conditionally.
 *   - `call-site`  — a bare `deps.x` chain handed straight to a registering
 *     `.with*()` call. Catches the case the type check structurally cannot:
 *     a dep typed as a concrete handler class (`ExecuteEvaluationCommand`)
 *     rather than as one of the definition interfaces.
 */

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/** The builder methods that register a value — ADR-082 Rule 1's list. */
export const REGISTERING_BUILDER_METHODS = [
  "withCommand",
  "withCommandInstance",
  "withEventSubscriber",
  "withFoldProjection",
  "withMapProjection",
  "withProcessManager",
  "withProjection",
] as const;

/**
 * The rest of the builder's `with*` surface. These register nothing, so a dep
 * may be handed to them whole. ADR-082's 2026-07-29 amendment calls the two
 * lists together exhaustive over the builder; `builderWithMethodNames()` below
 * reads the class so a method neither list names fails rather than passes.
 */
export const NON_REGISTERING_BUILDER_METHODS = [
  "withAggregateType",
  "withFeatureFlagService",
  "withName",
] as const;

/**
 * The types the registering methods accept, keyed by the method that accepts
 * them (`staticBuilder.ts`: `withFoldProjection` 148, `withMapProjection` 181,
 * `withProjection` 212, `withEventSubscriber` 253, `withProcessManager` 291,
 * `withCommand` 316, `withCommandInstance` 364).
 *
 * `withProcessManager` takes an applier today and builds the definition itself;
 * `ProcessManagerDefinition` is listed alongside it because its docblock names
 * accepting one as "the ADR-082 Rule 1 hole", so a dep typed that way is a
 * violation whether or not an overload exists to take it.
 */
export const REGISTERED_VALUE_TYPES: Readonly<Record<string, string>> = {
  CommandHandler: "withCommandInstance",
  CommandHandlerClass: "withCommand",
  CommandHandlerClassStatic: "withCommandInstance",
  EventSubscriberDefinition: "withEventSubscriber",
  FoldProjectionDefinition: "withFoldProjection",
  MapProjectionDefinition: "withMapProjection",
  ProcessManagerApplier: "withProcessManager",
  ProcessManagerDefinition: "withProcessManager",
  StateProjectionDefinition: "withProjection",
};

export type Rule1ViolationKind = "deps-type" | "call-site";

export interface Rule1Violation {
  /** Directory name under `pipelines/`, e.g. `trace-processing`. */
  pipeline: string;
  /** Dotted path from the deps root, e.g. `automations.triggerMatchSubscriber`. */
  dep: string;
  kind: Rule1ViolationKind;
  /** The builder method that would register this value. */
  builderMethod: string;
  /** The offending type name, for `deps-type` violations. */
  typeName?: string;
  line: number;
  /** Human-readable, one line, names pipeline + dep + why. */
  message: string;
}

const PIPELINES_DIR = fileURLToPath(
  new URL("../../pipelines", import.meta.url),
);
const STATIC_BUILDER_FILE = fileURLToPath(
  new URL("../staticBuilder.ts", import.meta.url),
);

const registeringMethods: ReadonlySet<string> = new Set(
  REGISTERING_BUILDER_METHODS,
);

function parseSource(fileName: string, source: string): ts.SourceFile {
  return ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TS,
  );
}

/** Every `pipelines/<x>/pipeline.ts`, sorted, so failures are stable. */
export function listPipelineFiles(): { pipeline: string; filePath: string }[] {
  return readdirSync(PIPELINES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      pipeline: entry.name,
      filePath: `${PIPELINES_DIR}/${entry.name}/pipeline.ts`,
    }))
    .filter(({ filePath }) => {
      try {
        readFileSync(filePath);
        return true;
      } catch {
        return false;
      }
    })
    .sort((a, b) => (a.pipeline < b.pipeline ? -1 : 1));
}

function lineOf(sourceFile: ts.SourceFile, node: ts.Node): number {
  return (
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
  );
}

/** Peels the wrappers that do not change what a type *is*. */
function unwrapTypeNode(node: ts.TypeNode): ts.TypeNode[] {
  if (ts.isParenthesizedTypeNode(node)) return unwrapTypeNode(node.type);
  if (ts.isArrayTypeNode(node)) return unwrapTypeNode(node.elementType);
  if (ts.isTypeOperatorNode(node)) return unwrapTypeNode(node.type);
  if (ts.isUnionTypeNode(node) || ts.isIntersectionTypeNode(node)) {
    return node.types.flatMap(unwrapTypeNode);
  }
  return [node];
}

function typeReferenceName(node: ts.TypeReferenceNode): string {
  return ts.isQualifiedName(node.typeName)
    ? node.typeName.right.text
    : node.typeName.text;
}

/** Local `interface X {}` / `type X = {}` declarations, so aliases resolve. */
function collectLocalTypeDeclarations(
  sourceFile: ts.SourceFile,
): Map<string, ts.TypeNode | ts.InterfaceDeclaration> {
  const declarations = new Map<string, ts.TypeNode | ts.InterfaceDeclaration>();
  for (const statement of sourceFile.statements) {
    if (ts.isInterfaceDeclaration(statement)) {
      declarations.set(statement.name.text, statement);
    } else if (ts.isTypeAliasDeclaration(statement)) {
      declarations.set(statement.name.text, statement.type);
    }
  }
  return declarations;
}

function membersOf(
  declaration: ts.TypeNode | ts.InterfaceDeclaration,
): readonly ts.TypeElement[] | null {
  if (ts.isInterfaceDeclaration(declaration)) return declaration.members;
  if (ts.isTypeLiteralNode(declaration)) return declaration.members;
  return null;
}

function describeDepsTypeViolation({
  pipeline,
  dep,
  typeName,
  builderMethod,
  line,
}: {
  pipeline: string;
  dep: string;
  typeName: string;
  builderMethod: string;
  line: number;
}): string {
  return (
    `${pipeline}: dep \`${dep}\` is a ${typeName}, which ADR-082 Rule 1 forbids — ` +
    `it is the value \`.${builderMethod}()\` registers (pipeline.ts:${line}). ` +
    `Construct it in pipeline.ts and let the dep be an argument to it.`
  );
}

function describeCallSiteViolation({
  pipeline,
  dep,
  builderMethod,
  line,
}: {
  pipeline: string;
  dep: string;
  builderMethod: string;
  line: number;
}): string {
  return (
    `${pipeline}: \`.${builderMethod}()\` is handed \`deps.${dep}\` directly ` +
    `(pipeline.ts:${line}), which ADR-082 Rule 1 forbids — the argument must be ` +
    `constructed in pipeline.ts; \`deps.x\` may appear inside it, never be it.`
  );
}

function collectDepsTypeViolations({
  pipeline,
  sourceFile,
  declaration,
  localTypes,
  pathPrefix,
  seen,
}: {
  pipeline: string;
  sourceFile: ts.SourceFile;
  declaration: ts.TypeNode | ts.InterfaceDeclaration;
  localTypes: Map<string, ts.TypeNode | ts.InterfaceDeclaration>;
  pathPrefix: string;
  seen: Set<string>;
}): Rule1Violation[] {
  const members = membersOf(declaration);
  if (!members) return [];

  const violations: Rule1Violation[] = [];

  for (const member of members) {
    if (!ts.isPropertySignature(member) || !member.type) continue;
    const name = ts.isIdentifier(member.name)
      ? member.name.text
      : member.name.getText(sourceFile);
    const dep = pathPrefix ? `${pathPrefix}.${name}` : name;
    const line = lineOf(sourceFile, member.name);

    for (const typeNode of unwrapTypeNode(member.type)) {
      if (ts.isTypeLiteralNode(typeNode)) {
        violations.push(
          ...collectDepsTypeViolations({
            pipeline,
            sourceFile,
            declaration: typeNode,
            localTypes,
            pathPrefix: dep,
            seen,
          }),
        );
        continue;
      }
      if (!ts.isTypeReferenceNode(typeNode)) continue;

      const typeName = typeReferenceName(typeNode);
      const builderMethod = REGISTERED_VALUE_TYPES[typeName];
      if (builderMethod) {
        violations.push({
          pipeline,
          dep,
          kind: "deps-type",
          builderMethod,
          typeName,
          line,
          message: describeDepsTypeViolation({
            pipeline,
            dep,
            typeName,
            builderMethod,
            line,
          }),
        });
        continue;
      }

      // A dep may be typed through a bundle declared in the same file. Follow
      // it, so hiding a definition one alias deep does not evade the rule.
      const local = localTypes.get(typeName);
      if (local && !seen.has(typeName)) {
        seen.add(typeName);
        violations.push(
          ...collectDepsTypeViolations({
            pipeline,
            sourceFile,
            declaration: local,
            localTypes,
            pathPrefix: dep,
            seen,
          }),
        );
      }
    }
  }

  return violations;
}

/**
 * The dotted path of a bare `deps.a.b` chain, or `null` when the expression is
 * anything else — a call, a `new`, an object literal. `deps` handed over whole
 * reads as `<deps>`.
 */
function bareDepsChain(
  expression: ts.Expression,
  depsIdentifier: string,
): string | null {
  const parts: string[] = [];
  let current: ts.Node = expression;

  for (;;) {
    if (
      ts.isNonNullExpression(current) ||
      ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isSatisfiesExpression(current)
    ) {
      current = current.expression;
      continue;
    }
    if (ts.isPropertyAccessExpression(current)) {
      parts.unshift(current.name.text);
      current = current.expression;
      continue;
    }
    break;
  }

  if (!ts.isIdentifier(current) || current.text !== depsIdentifier) return null;
  return parts.length > 0 ? parts.join(".") : "<deps>";
}

function forEachDescendant(node: ts.Node, visit: (node: ts.Node) => void) {
  visit(node);
  node.forEachChild((child) => forEachDescendant(child, visit));
}

function registeringCallsIn(node: ts.Node): ts.CallExpression[] {
  const calls: ts.CallExpression[] = [];
  forEachDescendant(node, (child) => {
    if (
      ts.isCallExpression(child) &&
      ts.isPropertyAccessExpression(child.expression) &&
      registeringMethods.has(child.expression.name.text)
    ) {
      calls.push(child);
    }
  });
  return calls;
}

/**
 * A pipeline file's composition functions: the ones that actually call the
 * builder's registering methods. Anything else in the file (a process-manager
 * applier factory, say) takes deps that Rule 1 says nothing about.
 */
function compositionFunctions(sourceFile: ts.SourceFile): {
  depsIdentifier: string;
  depsTypeName: string | null;
  body: ts.Node;
}[] {
  const functions: {
    depsIdentifier: string;
    depsTypeName: string | null;
    body: ts.Node;
  }[] = [];

  for (const statement of sourceFile.statements) {
    if (!ts.isFunctionDeclaration(statement) || !statement.body) continue;
    if (registeringCallsIn(statement.body).length === 0) continue;

    const parameter = statement.parameters[0];
    if (!parameter || !ts.isIdentifier(parameter.name)) continue;

    const typeNode = parameter.type;
    functions.push({
      depsIdentifier: parameter.name.text,
      depsTypeName:
        typeNode && ts.isTypeReferenceNode(typeNode)
          ? typeReferenceName(typeNode)
          : null,
      body: statement.body,
    });
  }

  return functions;
}

/** Every ADR-082 Rule 1 violation in one `pipelines/<x>/pipeline.ts`. */
export function analyzePipelineFile({
  pipeline,
  filePath,
}: {
  pipeline: string;
  filePath: string;
}): Rule1Violation[] {
  return analyzePipelineSource({
    pipeline,
    fileName: filePath,
    source: readFileSync(filePath, "utf8"),
  });
}

/** The same analysis over source text, so the guard's own failure is testable. */
export function analyzePipelineSource({
  pipeline,
  fileName = `${pipeline}/pipeline.ts`,
  source,
}: {
  pipeline: string;
  fileName?: string;
  source: string;
}): Rule1Violation[] {
  const sourceFile = parseSource(fileName, source);
  const localTypes = collectLocalTypeDeclarations(sourceFile);
  const violations: Rule1Violation[] = [];

  for (const composition of compositionFunctions(sourceFile)) {
    const depsDeclaration = composition.depsTypeName
      ? localTypes.get(composition.depsTypeName)
      : undefined;
    if (depsDeclaration) {
      violations.push(
        ...collectDepsTypeViolations({
          pipeline,
          sourceFile,
          declaration: depsDeclaration,
          localTypes,
          pathPrefix: "",
          seen: new Set(
            composition.depsTypeName ? [composition.depsTypeName] : [],
          ),
        }),
      );
    }

    for (const call of registeringCallsIn(composition.body)) {
      if (!ts.isPropertyAccessExpression(call.expression)) continue;
      const builderMethod = call.expression.name.text;

      for (const argument of call.arguments) {
        const dep = bareDepsChain(argument, composition.depsIdentifier);
        if (dep === null) continue;
        const line = lineOf(sourceFile, argument);
        violations.push({
          pipeline,
          dep,
          kind: "call-site",
          builderMethod,
          line,
          message: describeCallSiteViolation({
            pipeline,
            dep,
            builderMethod,
            line,
          }),
        });
      }
    }
  }

  return violations;
}

/** Every ADR-082 Rule 1 violation across every pipeline, sorted for stability. */
export function analyzeAllPipelines(): Rule1Violation[] {
  return listPipelineFiles()
    .flatMap(analyzePipelineFile)
    .sort((a, b) =>
      `${a.pipeline}/${a.dep}/${a.kind}`.localeCompare(
        `${b.pipeline}/${b.dep}/${b.kind}`,
      ),
    );
}

/**
 * The builder's whole `with*` surface, read from `staticBuilder.ts`. A method
 * this module has not classified is a hole in the rule, not a pass.
 */
export function builderWithMethodNames(): string[] {
  const sourceFile = parseSource(
    STATIC_BUILDER_FILE,
    readFileSync(STATIC_BUILDER_FILE, "utf8"),
  );
  const names = new Set<string>();

  forEachDescendant(sourceFile, (node) => {
    if (
      ts.isMethodDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text.startsWith("with")
    ) {
      names.add(node.name.text);
    }
  });

  return [...names].sort();
}
